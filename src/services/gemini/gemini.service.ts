import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { decodeBase64Json } from '../../common/utils/base64';
import { type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import {
  DEFAULT_REASONING_MODEL,
  type ReasoningCallOptions,
  type ReasoningProvider,
  type ReasoningProviderId,
} from '../reasoning/reasoning-model';
import type { JSONValue, LanguageModel } from 'ai';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { GoogleSearchItem } from '../search-item';
import { candidate, candidate_source } from '../../generated/prisma/client';
import { InstitutionType } from '../../generated/prisma/enums';
import { CandidateWithHistory } from '../../roles/search/candidate-scoring.service';
import { countryName } from '../../roles/search/filter-terms';
import type { Candidate } from '../../roles/search/extract-candidate';
import type { IndexedCandidateScore } from '../../roles/search/candidate-score';
import { addUsage, fromSdkUsage, type GeminiUsage } from './gemini-usage';
import {
  normalizeCandidate,
  seedCandidate,
  type CandidateRecord,
  type RawCandidate,
} from '../../roles/search/candidate-profile';
import {
  EXPANSION_CATEGORIES,
  ExpansionSeeds,
  ExpansionsByCategory,
  MAX_TERM_LENGTH,
  MAX_TERMS_PER_SEED,
  normalizeExpansionGroups,
} from '../../roles/search/criterion-expansions';

// Exported so callers persisting a role_result's ai_platform/ai_model
// (SearchService) can record exactly which model actually produced the
// judgment, without hardcoding the string a second time.
// The default reasoning model (see reasoning-model.ts).
export const GEMINI_MODEL = DEFAULT_REASONING_MODEL.model;

// Turns thinking off for speed and cost where the model allows it; Pro-tier
// models can't disable thinking, so they get their default.
function noThinking(model: string) {
  return /flash/i.test(model)
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined;
}
export const GEMINI_PLATFORM = 'Gemini';

// Bounds a single generateText call so a stuck or abnormally slow request
// (e.g. an oversized batch) fails with a clear timeout error instead of
// hanging the caller indefinitely.
const GEMINI_CALL_TIMEOUT_MS = 120_000;
// Expansion runs while the recruiter waits on a filter save, so it gets a
// much shorter leash; on timeout the save goes ahead with literal terms.
const EXPAND_SEARCH_TERMS_TIMEOUT_MS = 15_000;
const SCORE_CANDIDATES_TIMEOUT_MS = 30_000;
const RESEARCH_SEARCH_TIMEOUT_MS = 60_000;
const RESEARCH_STRUCTURE_TIMEOUT_MS = 30_000;
const REDIRECT_RESOLVE_TIMEOUT_MS = 3_000;

const candidateSchema = z.object({
  // These three map directly onto a candidate_source row created alongside
  // the candidate (main: true) — see SearchService.upsertCandidate.
  source_title: z.string(),
  source_name: z.string(),
  source_url: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  country_calling_code: z.string().optional(),
  current_location_city: z.string().optional(),
  current_location_country_code: z.string().optional(),
  current_location_postal_code: z.string().optional(),
  open_to_relocation: z.boolean().optional(),
  open_to_remote_work: z.boolean().optional(),
  current_work_authorization_status: z.string().optional(),
  experience_years: z.number().int().optional(),
  experience_roles: z.array(z.string()).optional(),
  current_title: z.string().optional(),
  current_company: z.string().optional(),
  current_salary: z.number().optional(),
  current_salary_currency: z.string().optional(),
  current_role_start_date: z.string().optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  diversity: z.array(z.string()).optional(),
  summary: z.string().optional(),
  image_url: z.string().optional(),
});

const matchSchema = z.object({
  candidate: candidateSchema,
  summary: z.string(),
  reasoning: z.string(),
  skills_matched: z.array(z.string()),
  // Education criteria the result shows evidence of, copied from the
  // criteria verbatim. Kept off candidateSchema because the candidate table
  // has no column for it — it only feeds CandidateScoringService.
  qualifications_matched: z.array(z.string()).optional(),
  score: z.number().int().min(0).max(100),
});

export type GeminiCandidateFields = z.infer<typeof candidateSchema>;
export type GeminiCandidateMatch = z.infer<typeof matchSchema>;

export interface FormatCandidatesResult {
  matches: GeminiCandidateMatch[];
  tokensUsed: number;
  // Null when Gemini didn't report the counts (or no call was made).
  usage: GeminiUsage | null;
}

// Unlike matchSchema (used when extracting a brand-new candidate from a
// search snippet), an already-known candidate's fields are already on
// file — Gemini is only judging fit, not extracting data — so this omits
// the nested candidate schema and instead carries candidate_uid, since
// there's no source-URL dedup step here to attribute a response back to
// the right input candidate.
const knownCandidateMatchSchema = z.object({
  candidate_uid: z.string(),
  summary: z.string(),
  reasoning: z.string(),
  skills_matched: z.array(z.string()),
  score: z.number().int().min(0).max(100),
});

export type GeminiKnownCandidateMatch = z.infer<
  typeof knownCandidateMatchSchema
>;

export interface ScoreKnownCandidatesResult {
  matches: GeminiKnownCandidateMatch[];
  tokensUsed: number;
  usage: GeminiUsage | null;
}

const candidateExperienceEnrichmentSchema = z.object({
  company_name: z.string(),
  company_location: z.string().optional(),
  role: z.string(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  responsibilities: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

const candidateEducationEnrichmentSchema = z.object({
  institution_name: z.string(),
  institution_type: z.enum(InstitutionType),
  institution_location: z.string().optional(),
  degree: z.string().optional(),
  field_of_study: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  summary: z.string().optional(),
  additional_info: z.string().optional(),
});

const candidateSourceEnrichmentSchema = z.object({
  title: z.string(),
  name: z.string(),
  url: z.string().optional(),
});

// Unlike candidateSchema (used when creating a brand new candidate record
// from a role search), this describes new facts to merge onto an already-
// known candidate, so it omits the source_title/source_name/source_url
// fields that only make sense for a fresh record's initial source.
const candidateEnrichmentSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  country_calling_code: z.string().optional(),
  current_location_city: z.string().optional(),
  current_location_country_code: z.string().optional(),
  current_location_postal_code: z.string().optional(),
  open_to_relocation: z.boolean().optional(),
  open_to_remote_work: z.boolean().optional(),
  current_work_authorization_status: z.string().optional(),
  experience_years: z.number().int().optional(),
  experience_roles: z.array(z.string()).optional(),
  current_title: z.string().optional(),
  current_company: z.string().optional(),
  current_salary: z.number().optional(),
  current_salary_currency: z.string().optional(),
  current_role_start_date: z.string().optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  diversity: z.array(z.string()).optional(),
  summary: z.string().optional(),
  image_url: z.string().optional(),
  additional_sources: z.array(candidateSourceEnrichmentSchema).optional(),
  experience: z.array(candidateExperienceEnrichmentSchema).optional(),
  education: z.array(candidateEducationEnrichmentSchema).optional(),
});

export type GeminiCandidateExperienceEnrichment = z.infer<
  typeof candidateExperienceEnrichmentSchema
>;
export type GeminiCandidateEducationEnrichment = z.infer<
  typeof candidateEducationEnrichmentSchema
>;
export type GeminiCandidateSourceEnrichment = z.infer<
  typeof candidateSourceEnrichmentSchema
>;
export type GeminiCandidateEnrichment = z.infer<
  typeof candidateEnrichmentSchema
>;

export interface EnrichCandidateResult {
  enrichment: GeminiCandidateEnrichment;
  tokensUsed: number;
}

// Mirrors ChildFilterItemDto/FilterItemDto (src/roles/dto/role_filter.dto.ts)
// exactly, so a parsed job spec can be persisted as real role_filter_item/
// role_filter_child rows with no translation step, and later read by the
// existing role-filter-parser.ts the same way a human-entered filter would be.
const jobSpecFilterChildSchema = z.object({
  title: z.string(),
  value: z.string().optional(),
  list_value: z.array(z.string()).optional(),
  boolean_value: z.boolean().optional(),
});

const jobSpecFilterItemSchema = z.object({
  category: z.enum([
    'location',
    'job_titles',
    'skills',
    'languages',
    'industry',
    'companies',
    'education',
    'experience',
  ]),
  value: z.string().optional(),
  list_value: z.array(z.string()).optional(),
  priority: z.enum(['ESSENTIAL', 'OPTIONAL']),
  non_negotiable: z.boolean().optional(),
  children: z.array(jobSpecFilterChildSchema).optional(),
});

const jobSpecParseResultSchema = z.object({
  items: z.array(jobSpecFilterItemSchema),
});

export type GeminiJobSpecFilterItem = z.infer<typeof jobSpecFilterItemSchema>;

// Matches buildJobSpecPrompt's per-category contract: location/industry/
// experience carry their real signal in "value" (country code / free text /
// a numeric string) and never in "list_value"; every other category carries
// it in "list_value" and never sets "value". Children are always supplementary
// (region/remote_work, title_option, company_type, institutions/type) — no
// category uses children alone as its real signal, so a stray children-only
// item (e.g. a hallucinated "remote_work" child with no country code) is
// just as empty as one with no fields at all.
const SCALAR_VALUE_CATEGORIES = new Set(['location', 'industry', 'experience']);

function hasRealSignal(item: GeminiJobSpecFilterItem): boolean {
  if (SCALAR_VALUE_CATEGORIES.has(item.category)) {
    return !!item.value;
  }
  return !!(item.list_value && item.list_value.length > 0);
}

const searchTermExpansionSchema = z.object({
  groups: z.array(
    z.object({
      category: z.enum(EXPANSION_CATEGORIES),
      seed: z.string(),
      terms: z.array(z.string()),
    }),
  ),
});

export interface ExpandSearchTermsResult {
  byCategory: ExpansionsByCategory;
  model: string;
  tokensUsed: number;
}

export interface ParseJobSpecResult {
  items: GeminiJobSpecFilterItem[];
  tokensUsed: number;
}

const extractedCandidateSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  country_calling_code: z.string().optional(),
  current_location_city: z.string().optional(),
  current_location_country_code: z.string().optional(),
  current_location_postal_code: z.string().optional(),
  open_to_relocation: z.boolean().optional(),
  open_to_remote_work: z.boolean().optional(),
  current_work_authorization_status: z.string().optional(),
  experience_years: z.number().int().optional(),
  experience_roles: z.array(z.string()).optional(),
  current_title: z.string().optional(),
  current_company: z.string().optional(),
  current_salary: z.number().optional(),
  current_salary_currency: z.string().optional(),
  current_role_start_date: z.string().optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  diversity: z.array(z.string()).optional(),
  summary: z.string().optional(),
  image_url: z.string().optional(),
});

const candidateScoresSchema = z.object({
  scores: z.array(
    z.object({
      index: z.number().int(),
      score: z.number().int().describe('0 to 100'),
      summary: z.string().describe('One short sentence on fit.'),
      reasoning: z.string().describe('A slightly more detailed assessment.'),
      skills_matched: z.array(z.string()),
      missing: z.array(z.string()),
      nonNegotiableUnconfirmed: z.array(z.string()),
      candidate: extractedCandidateSchema.optional(),
    }),
  ),
});

const researchSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      fact: z.string(),
      sourceNumber: z.number().int(),
    }),
  ),
  identityConfidence: z.enum(['high', 'medium', 'low']),
  identityReason: z.string(),
  score: z.number().int().describe('0 to 100'),
  reasoning: z.string(),
  // Optional, so an older-shaped response still parses.
  qualifications: z
    .array(z.string())
    .optional()
    .describe(
      'Professional qualifications, designations and certifications the sourced findings confirm, e.g. "CA(SA)".',
    ),
  candidate: extractedCandidateSchema
    .extend({
      additional_sources: z.array(candidateSourceEnrichmentSchema).optional(),
      experience: z.array(candidateExperienceEnrichmentSchema).optional(),
      education: z.array(candidateEducationEnrichmentSchema).optional(),
    })
    .optional(),
});

const SCORING_INSTRUCTIONS = `You screen recruiting search results against a role.
For each candidate you only see a short public search snippet of their LinkedIn profile (name, headline, company, location, about 150 characters of text), not the full profile.
Rules:
- Score each candidate 0-100 for fit with the role. Job title and seniority fit, location fit and essential criteria weigh most; nice-to-haves add a little.
- "skills_matched": criteria the snippet clearly supports. "missing": criteria the snippet does not show. Absence of evidence means unconfirmed, not failed; only treat a criterion as failed when the snippet contradicts it (e.g. a different country, an excluded current employer).
- "nonNegotiableUnconfirmed": only criteria explicitly tagged NON-NEGOTIABLE in the role that the snippet does not confirm. ESSENTIAL alone does not make a criterion non-negotiable. Empty when the role has no NON-NEGOTIABLE criteria or all are confirmed.
- "summary": one short sentence on fit. "reasoning": a slightly more detailed assessment.
- Also extract a query-independent "candidate" record from the snippet only, using these field names: first_name, last_name, email, phone, country_calling_code, current_location_city, current_location_country_code (ISO 3166-1 alpha-2), current_location_postal_code, open_to_relocation, open_to_remote_work, current_work_authorization_status, experience_years, experience_roles, current_title, current_company, current_salary, current_salary_currency (ISO 4217), current_role_start_date (ISO 8601; if only a year is known, use YYYY-01-01), skills, languages, diversity, summary, image_url.
- "skills" is a string array of short canonical skill names the person has, not the role's wishlist. Include a stated certification as a skill. A title like "React Native Developer" may include "react native". If unsure, omit the skill.
- Do not guess contact details (email, phone), salary, diversity, work authorization, or relocation/remote flags unless they literally appear in the snippet.
- Never invent facts that are not in the snippet. Leave candidate fields out when the snippet does not support them. Skills may be sparse.
- Return exactly one entry per candidate, using its index.`;

const RESEARCH_INSTRUCTIONS = `You research a recruiting candidate's public footprint with Google Search.
Look beyond LinkedIn: GitHub, personal sites, company team pages, talks, articles, open-source work, awards, press, app store listings.
Rules:
- Only state facts a search result actually supports. Do not guess.
- Make sure each fact is about this same person: tie it to their LinkedIn URL, their company or headline, or their name plus location. If a result may be a different person with the same name, say so explicitly.
- Write short factual sentences. If you find little, say so.`;

const STRUCTURE_INSTRUCTIONS = `You turn grounded research notes about a recruiting candidate into a structured report.
Rules:
- Use only facts in the notes that carry a [source N] tag, and cite that N as sourceNumber. Drop anything without a source.
- A finding is a fact about the person (work, projects, location, employers, education, public output). Leave out remarks about the search itself, such as what a search did or did not turn up.
- Drop facts the notes flag as possibly a different person, and mention the doubt in identityReason.
- identityConfidence: "high" when findings tie to the LinkedIn URL or the stated company plus name; "medium" when they tie by name plus role or location only; "low" when the link is weak, conflicting or there are no findings.
- "score" 0-100 against the role, using the candidate's search profile plus the findings. Unconfirmed criteria are unknown, not failed. "reasoning" explains the score.
- Also extract a query-independent "candidate" record from the search profile plus the source-backed notes, using these field names: first_name, last_name, email, phone, country_calling_code, current_location_city, current_location_country_code (ISO 3166-1 alpha-2), current_location_postal_code, open_to_relocation, open_to_remote_work, current_work_authorization_status, experience_years, experience_roles, current_title, current_company, current_salary, current_salary_currency (ISO 4217), current_role_start_date (ISO 8601; if only a year is known, use YYYY-01-01), skills (string array of short canonical names the person has, not the role's wishlist; include stated certifications), languages, diversity, summary, image_url.
- Also extract every distinct employment history entry into "experience": company_name and role are required; include start_date/end_date (ISO dates, approximate if only a year is known) and responsibilities/skills when available.
- Also extract every distinct education history entry into "education": institution_name and institution_type (one of HIGH_SCHOOL, COLLEGE, UNIVERSITY, COURSE, OTHER) are required; include institution_location/degree/field_of_study/start_date/end_date (ISO dates, approximate if only a year is known) when available.
- "qualifications": professional qualifications, designations and certifications (e.g. "CA(SA)", "CFA", "AWS Certified Solutions Architect") that a sourced finding confirms. Empty when none are confirmed.
- List any newly-found platforms in "additional_sources" as objects with "title", "name" (the platform, e.g. "GitHub"), and "url" when found. Do not repeat the LinkedIn URL already in the search profile.
- Do not guess contact details (email, phone), salary, diversity, work authorization, or relocation/remote flags unless they literally appear in the notes.
- Never invent facts. Leave fields out when there is no evidence.`;

// research's structured record as Gemini returned it, before the search
// profile seeds it.
export type ResearchRecord = NonNullable<
  z.infer<typeof researchSchema>['candidate']
>;

export interface CandidateResearch {
  summary: string;
  findings: { fact: string; sourceUrl: string }[];
  identityConfidence: 'high' | 'medium' | 'low';
  identityReason: string;
  score: number;
  reasoning: string;
  sources: { url: string; title?: string }[];
  searchQueries: string[];
  candidate: CandidateRecord;
  // What the structured output itself states, unseeded: the evidence the
  // deterministic re-score may use. Never includes the search profile seed.
  verified: { record: ResearchRecord | null; qualifications: string[] };
  // Both calls (grounded search + structuring); null if neither reported.
  // Grounded Google Search requests are billed separately and aren't here.
  usage: GeminiUsage | null;
}

function describeCandidate(candidate: Partial<Candidate>): string {
  return [
    `name: ${candidate.name}`,
    candidate.headline && `headline: ${candidate.headline}`,
    candidate.company && `company: ${candidate.company}`,
    candidate.location && `location: ${candidate.location}`,
    candidate.linkedinUrl && `linkedin: ${candidate.linkedinUrl}`,
    candidate.snippet && `snippet: ${candidate.snippet}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Settings a provider adds to a generateText call.
export type ProviderCallSettings = {
  providerOptions?: Record<string, Record<string, JSONValue>>;
  maxOutputTokens?: number;
};

export type ReasoningApiKeys = {
  vertexProjectId: string;
  vertexServiceAccount: string;
  // Gemini's Vertex location, default 'global'.
  vertexAiLocation: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
};

// Every reasoning call (prompts, schemas, structured output, usage) on the
// AI SDK, whatever the provider. A provider supplies its models and the
// call settings it needs. Deep research's web retrieval is always Gemini
// with Google Search grounding (see groundsWithOwnModel); the org's model reads
// and structures what it found.
export abstract class AiSdkReasoningProvider implements ReasoningProvider {
  abstract readonly id: ReasoningProviderId;
  // The provider's model when a call doesn't name one.
  abstract readonly defaultModel: string;
  protected readonly logger = new Logger(this.constructor.name);
  private readonly models = new Map<string, Promise<LanguageModel>>();

  constructor(protected readonly aiConf: ReasoningApiKeys) {}

  // Whether its API key is configured.
  abstract get enabled(): boolean;

  protected abstract createModel(modelId: string): Promise<LanguageModel>;

  // `fast`: a scoring or extraction call that doesn't need deep reasoning,
  // so the provider can turn thinking down where it allows.
  protected abstract callSettings(
    modelId: string,
    call: { fast: boolean },
  ): ProviderCallSettings;

  // Whether deep research's Google-grounded search runs on the org's own
  // model (Gemini only) rather than the default Gemini model.
  protected readonly groundsWithOwnModel: boolean = false;

  async formatCandidates(
    items: GoogleSearchItem[],
    filters: ParsedRoleFilters,
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<FormatCandidatesResult> {
    if (items.length === 0) return { matches: [], tokensUsed: 0, usage: null };

    this.logger.debug(
      `Formatting ${items.length} search result(s) with ${this.id} ${modelId}`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel(modelId);

    const { output, usage } = await generateText({
      model,
      prompt: this.buildPrompt(items, filters),
      output: Output.array({ element: matchSchema }),
      timeout: GEMINI_CALL_TIMEOUT_MS,
      // This is scoring each candidate against fixed criteria, not
      // multi-step reasoning — disabling thinking measured ~25% faster
      // and cheaper with no observed quality loss.
      ...this.callSettings(modelId, { fast: true }),
    });

    return {
      matches: output,
      tokensUsed: usage.totalTokens ?? 0,
      usage: fromSdkUsage(usage),
    };
  }

  // Scores candidates already on file (no new search snippet to extract
  // from) against the role's criteria, the same way formatCandidates scores
  // freshly-found ones — just reading from the stored profile instead.
  async scoreKnownCandidates(
    candidates: CandidateWithHistory[],
    filters: ParsedRoleFilters,
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<ScoreKnownCandidatesResult> {
    if (candidates.length === 0) {
      return { matches: [], tokensUsed: 0, usage: null };
    }

    this.logger.debug(
      `Scoring ${candidates.length} existing candidate(s) with ${this.id} ${modelId}`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel(modelId);

    const { output, usage } = await generateText({
      model,
      prompt: this.buildKnownCandidatePrompt(candidates, filters),
      output: Output.array({ element: knownCandidateMatchSchema }),
      timeout: GEMINI_CALL_TIMEOUT_MS,
      ...this.callSettings(modelId, { fast: true }),
    });

    return {
      matches: output,
      tokensUsed: usage.totalTokens ?? 0,
      usage: fromSdkUsage(usage),
    };
  }

  // One call scores a page of LinkedIn snippets; the caller handles failure.
  async scoreCandidates(
    roleDescription: string,
    candidates: Candidate[],
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<{
    scores: IndexedCandidateScore[];
    tokensUsed: number;
    usage: GeminiUsage | null;
  }> {
    if (candidates.length === 0) {
      return { scores: [], tokensUsed: 0, usage: null };
    }
    const { generateText, Output } = await this.loadAi();
    const prompt = [
      'ROLE:',
      roleDescription,
      '',
      'CANDIDATES:',
      ...candidates.map(
        (candidate, index) =>
          `[${index}]\n${describeCandidate({ ...candidate, linkedinUrl: undefined })}`,
      ),
    ].join('\n');

    const { output, usage } = await generateText({
      model: await this.getModel(modelId),
      system: SCORING_INSTRUCTIONS,
      prompt,
      output: Output.object({ schema: candidateScoresSchema }),
      ...this.callSettings(modelId, { fast: true }),
      timeout: SCORE_CANDIDATES_TIMEOUT_MS,
      maxRetries: 1,
    });
    return {
      scores: output.scores.map((row) => {
        const { candidate, ...score } = row;
        return candidate ? { ...score, candidate } : score;
      }),
      tokensUsed: usage.totalTokens ?? 0,
      usage: fromSdkUsage(usage),
    };
  }

  // Pass 1 searches with Google grounding (which can't return structured
  // output); pass 2 structures only the source-backed notes.
  async researchCandidate(
    roleDescription: string,
    candidate: Partial<Candidate>,
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<CandidateResearch> {
    const { generateText, Output } = await this.loadAi();
    const vertex = await this.getVertex();

    const searched = await generateText({
      model: vertex(this.groundsWithOwnModel ? modelId : GEMINI_MODEL),
      system: RESEARCH_INSTRUCTIONS,
      prompt: `CANDIDATE:\n${describeCandidate(candidate)}\n\nROLE THEY ARE BEING CONSIDERED FOR:\n${roleDescription}\n\nResearch this person.`,
      tools: {
        // Vertex tool typings are slightly ahead of this `ai` version.
        google_search: vertex.tools.googleSearch({}) as never,
      },
      timeout: RESEARCH_SEARCH_TIMEOUT_MS,
      maxRetries: 1,
    });

    const grounding = (
      searched.providerMetadata?.google as
        | {
            groundingMetadata?: {
              webSearchQueries?: string[] | null;
              groundingChunks?:
                | { web?: { uri: string; title?: string | null } | null }[]
                | null;
              groundingSupports?:
                | {
                    segment?: { text?: string | null } | null;
                    groundingChunkIndices?: number[] | null;
                  }[]
                | null;
            } | null;
          }
        | undefined
    )?.groundingMetadata;
    const chunks = (grounding?.groundingChunks ?? []).map((chunk) => chunk.web);
    const sources = await Promise.all(
      chunks.map(async (web) =>
        web
          ? {
              url: await this.resolveRedirect(web.uri),
              title: web.title ?? undefined,
            }
          : undefined,
      ),
    );

    const notes = (grounding?.groundingSupports ?? [])
      .map((support) => {
        const text = support.segment?.text?.trim();
        const tags = (support.groundingChunkIndices ?? [])
          .filter((i) => sources[i])
          .map((i) => `[source ${i + 1}]`);
        return text && tags.length ? `${text} ${tags.join(' ')}` : undefined;
      })
      .filter(Boolean);
    const sourceList = sources
      .map((source, i) =>
        source
          ? `[source ${i + 1}] ${source.title ?? ''} ${source.url}`
          : undefined,
      )
      .filter(Boolean);

    const { output, usage: structureUsage } = await generateText({
      model: await this.getModel(modelId),
      system: STRUCTURE_INSTRUCTIONS,
      prompt: [
        'CANDIDATE SEARCH PROFILE:',
        describeCandidate(candidate),
        '',
        'ROLE:',
        roleDescription,
        '',
        'SOURCE-BACKED NOTES:',
        notes.length ? notes.join('\n') : '(none)',
        '',
        'FULL RESEARCH TEXT (for context; facts without a [source N] tag must not become findings):',
        searched.text || '(empty)',
        '',
        'SOURCES:',
        sourceList.length ? sourceList.join('\n') : '(none)',
      ].join('\n'),
      output: Output.object({ schema: researchSchema }),
      ...this.callSettings(modelId, { fast: false }),
      timeout: RESEARCH_STRUCTURE_TIMEOUT_MS,
      maxRetries: 1,
    });

    const findings = output.findings.flatMap(({ fact, sourceNumber }) => {
      const source = sources[sourceNumber - 1];
      return source ? [{ fact, sourceUrl: source.url }] : [];
    });
    const usedSources = sources.filter(
      (source): source is NonNullable<typeof source> => !!source,
    );
    const seed = seedCandidate({
      name: candidate.name ?? '',
      headline: candidate.headline,
      company: candidate.company,
      location: candidate.location,
      linkedinUrl: candidate.linkedinUrl ?? '',
      imageUrl: candidate.imageUrl,
    });
    const raw: RawCandidate | undefined = output.candidate
      ? {
          ...output.candidate,
          additional_sources: output.candidate.additional_sources,
          experience: output.candidate.experience,
          education: output.candidate.education,
        }
      : undefined;

    return {
      summary: output.summary,
      findings,
      identityConfidence:
        findings.length === 0 ? 'low' : output.identityConfidence,
      identityReason: output.identityReason,
      score: Math.max(0, Math.min(100, Math.round(output.score))),
      reasoning: output.reasoning,
      sources: usedSources,
      searchQueries: grounding?.webSearchQueries ?? [],
      candidate: normalizeCandidate(raw, seed),
      verified: {
        record: output.candidate ?? null,
        qualifications: output.qualifications ?? [],
      },
      usage: addUsage(
        fromSdkUsage(searched.usage),
        fromSdkUsage(structureUsage),
      ),
    };
  }

  // Digs deeper on one already-identified candidate to build out their
  // profile — unlike formatCandidates, this isn't judging fit against a
  // role, just extracting whatever new facts the search results contain.
  async enrichCandidate(
    items: GoogleSearchItem[],
    candidate: candidate & { sources: candidate_source[] },
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<EnrichCandidateResult> {
    if (items.length === 0) {
      return { enrichment: {}, tokensUsed: 0 };
    }

    this.logger.debug(
      `Enriching candidate profile from ${items.length} search result(s)`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel(modelId);

    const { output, usage } = await generateText({
      model,
      prompt: this.buildEnrichmentPrompt(items, candidate),
      output: Output.object({ schema: candidateEnrichmentSchema }),
      ...this.callSettings(modelId, { fast: false }),
    });

    return {
      enrichment: output,
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // Turns a pasted or uploaded job spec into draft role_filter_item rows —
  // same category/child vocabulary role-filter-parser.ts already reads, so
  // the result can be persisted and later edited/approved with no new
  // parsing logic needed anywhere downstream.
  async parseJobSpec(
    text: string,
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<ParseJobSpecResult> {
    this.logger.debug(`Parsing job spec with ${this.id} ${modelId}`);

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel(modelId);

    const { output, usage } = await generateText({
      model,
      prompt: this.buildJobSpecPrompt(text),
      output: Output.object({ schema: jobSpecParseResultSchema }),
      timeout: GEMINI_CALL_TIMEOUT_MS,
      ...this.callSettings(modelId, { fast: true }),
    });

    const filteredItems = output.items.filter(hasRealSignal);

    return {
      items: filteredItems,
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // "Generate from brief" on Edit role details: a short plain description
  // for the role page. Nothing is saved; the recruiter edits it first.
  async describeRole(
    { roleName, brief }: { roleName: string; brief: string },
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<{ description: string; tokensUsed: number }> {
    const { generateText } = await this.loadAi();
    const { text, usage } = await generateText({
      model: await this.getModel(modelId),
      prompt: [
        `Write a 2-3 sentence description of the "${roleName}" role for a recruiter's role page,`,
        'using only facts from the brief below. Plain text, no headings or bullet points,',
        'under 500 characters.',
        '',
        brief,
      ].join('\n'),
      timeout: GEMINI_CALL_TIMEOUT_MS,
      ...this.callSettings(modelId, { fast: true }),
    });
    return {
      description: text.trim().slice(0, 500),
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // Elaborates each title/skill seed into the adjacent phrasings people
  // actually put on their profiles (the nuanced ones like "side hustle" are
  // what surface unusual candidates), for use as x-ray OR groups. The model
  // output is normalized centrally: seed first, and a seed it gave no
  // alternate for is left out so the next save asks again.
  async expandSearchTerms(
    {
      seeds,
      roleName,
    }: {
      seeds: ExpansionSeeds;
      roleName: string;
    },
    { model: modelId = this.defaultModel }: ReasoningCallOptions = {},
  ): Promise<ExpandSearchTermsResult> {
    this.logger.debug(`Expanding search terms with ${this.id} ${modelId}`);

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel(modelId);

    const { output, usage } = await generateText({
      model,
      prompt: this.buildExpandSearchTermsPrompt(seeds, roleName),
      output: Output.object({ schema: searchTermExpansionSchema }),
      timeout: EXPAND_SEARCH_TERMS_TIMEOUT_MS,
      ...this.callSettings(modelId, { fast: true }),
    });

    return {
      byCategory: normalizeExpansionGroups(seeds, output.groups),
      model: modelId,
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // ai / @ai-sdk/google-vertex are ESM-only (no CJS build). This project
  // is CommonJS, so a static import would compile to require() and crash
  // at runtime with ERR_REQUIRE_ESM — dynamic import() is Node's documented
  // way for CJS code to load an ESM-only package. Kept as their own
  // methods (rather than inline) so tests can override them directly —
  // Jest's VM test environment can't execute a real dynamic import()
  // without the experimental-vm-modules flag.

  // Grounding chunks point at vertexaisearch.cloud.google.com redirect
  // links; follow one hop so recruiters see the real page. Falls back to
  // the redirect link if the lookup fails.
  private async resolveRedirect(url: string): Promise<string> {
    if (!url.includes('grounding-api-redirect')) return url;
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(REDIRECT_RESOLVE_TIMEOUT_MS),
      });
      return response.headers.get('location') ?? url;
    } catch {
      return url;
    }
  }

  protected async loadAi() {
    return import('ai');
  }

  protected async loadVertexProvider() {
    return import('@ai-sdk/google-vertex');
  }

  // One Vertex client per provider instance, authenticated with the
  // project's service account — never an API key.
  protected async getVertex() {
    const { createVertex } = await this.loadVertexProvider();
    return createVertex({
      project: this.aiConf.vertexProjectId,
      location: this.aiConf.vertexAiLocation,
      googleAuthOptions: {
        credentials: decodeBase64Json(this.aiConf.vertexServiceAccount),
      },
    });
  }

  private async getModel(modelId: string): Promise<LanguageModel> {
    let model = this.models.get(modelId);
    if (!model) {
      model = this.createModel(modelId);
      this.models.set(modelId, model);
    }
    return model;
  }

  // Google's Custom Search API doesn't return a photo directly — it returns
  // pagemap metadata scraped from the page, so a profile photo (when the
  // page exposes one) turns up as an og:image meta tag, a CSE-detected
  // image, or a thumbnail, roughly in that order of how likely it is to
  // actually be the person's photo rather than a site logo or icon.
  private extractImageUrl(item: GoogleSearchItem): string | undefined {
    const pagemap = item.pagemap as
      | {
          metatags?: Array<Record<string, string | undefined>>;
          cse_image?: Array<{ src?: string }>;
          cse_thumbnail?: Array<{ src?: string }>;
        }
      | undefined;
    return (
      pagemap?.metatags?.[0]?.['og:image'] ??
      pagemap?.cse_image?.[0]?.src ??
      pagemap?.cse_thumbnail?.[0]?.src
    );
  }

  private buildCriteria(filters: ParsedRoleFilters): unknown[] {
    return [
      ...filters.jobTitles.map((row) => ({
        category: 'job_titles',
        option: row.value.option,
        titles: row.value.titles,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...filters.skills.map((row) => ({
        category: 'skills',
        skills: row.value,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...filters.languages.map((row) => ({
        category: 'languages',
        languages: row.value,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...filters.companies.map((row) => ({
        category: 'companies',
        companies: row.value.names,
        type: row.value.type,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...filters.education.map((row) => ({
        category: 'education',
        qualifications: row.value.qualifications,
        institutions: row.value.institutions,
        institutionType: row.value.institutionType,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...(filters.location
        ? [
            {
              category: 'location',
              countryCode: filters.location.value.countryCode,
              country: countryName(filters.location.value.countryCode),
              regions: filters.location.value.regions,
              remoteWork: filters.location.value.remoteWork,
              workTypes: filters.location.value.workTypes,
              priority: filters.location.priority,
              nonNegotiable: filters.location.nonNegotiable,
            },
          ]
        : []),
      ...(filters.industry
        ? [
            {
              category: 'industry',
              industry: filters.industry.value,
              priority: filters.industry.priority,
              nonNegotiable: filters.industry.nonNegotiable,
            },
          ]
        : []),
      ...(filters.experience
        ? [
            {
              category: 'experience',
              minYears: filters.experience.value.minYears,
              priority: filters.experience.priority,
              nonNegotiable: filters.experience.nonNegotiable,
            },
          ]
        : []),
    ];
  }

  private buildPrompt(
    items: GoogleSearchItem[],
    filters: ParsedRoleFilters,
  ): string {
    const criteria = this.buildCriteria(filters);

    const results = items.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      description: (item.pagemap as any)?.metatags?.[0]?.[
        'og:description'
      ] as string,
      image: this.extractImageUrl(item),
    }));

    return [
      'You are extracting structured candidate profile data from Google search results for a recruiting pipeline.',
      'For each search result below, extract as much candidate information as you can infer from its title, link, snippet, and description.',
      'Set "source_title" to the search result\'s title verbatim, "source_name" to the platform the result came from (e.g. "LinkedIn"), and "source_url" to the result\'s link — include "source_url" only if one is actually present.',
      'When a result includes an "image" URL, copy it verbatim into "image_url" — do not fabricate one when it is absent.',
      'Do not guess contact details (email, phone) unless they literally appear in the text.',
      'Set "current_location_country_code" to the ISO 3166-1 alpha-2 code of where the person is based (e.g. "ZA", "US", "GB") only when the result states or clearly implies it; omit it otherwise.',
      'Set "qualifications_matched" to the education qualifications from the criteria (copied verbatim from the criteria) that the result shows evidence of — e.g. "CA(SA)" when the result says "CA (SA)" or "Chartered Accountant (SA)". Leave it empty when there is no evidence.',
      'Location and education criteria are real requirements, not keywords: a candidate based outside the required country (and not shown to be open to relocation), or with no evidence of a required qualification, must get a low "score" and the reasoning must say so.',
      'Then compare the candidate against the role criteria below: each criterion has a "priority" ("ESSENTIAL" or "OPTIONAL") and a "nonNegotiable" flag — weigh ESSENTIAL and non-negotiable criteria most heavily. Write a short "summary" explaining how well they match, a more detailed "reasoning" for that assessment, a "skills_matched" array listing which required/optional skills they actually have evidence of, and a "score" from 0-100 rating the overall match quality.',
      '',
      `Role criteria: ${JSON.stringify(criteria)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
    ].join('\n');
  }

  // Unlike buildPrompt, there is no search snippet to read — every field
  // here comes straight from the candidate's own stored record, so the
  // model is asked to judge fit, not extract facts.
  private buildKnownCandidatePrompt(
    candidates: CandidateWithHistory[],
    filters: ParsedRoleFilters,
  ): string {
    const criteria = this.buildCriteria(filters);

    const profiles = candidates.map((candidate) => ({
      candidate_uid: candidate.uid,
      name: [candidate.first_name, candidate.last_name]
        .filter(Boolean)
        .join(' '),
      current_title: candidate.current_title,
      current_company: candidate.current_company,
      experience_years: candidate.experience_years,
      skills: candidate.skills,
      languages: candidate.languages,
      location_country_code: candidate.current_location_country_code,
      open_to_relocation: candidate.open_to_relocation,
      open_to_remote_work: candidate.open_to_remote_work,
      experience: candidate.experience.map((entry) => ({
        company_name: entry.company_name,
        role: entry.role,
        start_date: entry.start_date,
        end_date: entry.end_date,
      })),
      education: candidate.education.map((entry) => ({
        institution_name: entry.institution_name,
        degree: entry.degree,
        field_of_study: entry.field_of_study,
      })),
    }));

    return [
      "You are evaluating candidates already on file in our database against a role's criteria — you are judging fit, not extracting new information, since every field below is already known.",
      'For each candidate below, compare them against the role criteria and write a short "summary", a more detailed "reasoning", a "skills_matched" array listing which required/optional skills they have evidence of, and a "score" from 0-100 rating the overall match quality.',
      'Always copy "candidate_uid" into your response verbatim from the input, so each judgment can be matched back to the right candidate.',
      'Each criterion below has a "priority" ("ESSENTIAL" or "OPTIONAL") and a "nonNegotiable" flag — weigh ESSENTIAL and non-negotiable criteria most heavily.',
      '',
      `Role criteria: ${JSON.stringify(criteria)}`,
      '',
      `Candidates: ${JSON.stringify(profiles)}`,
    ].join('\n');
  }

  private buildEnrichmentPrompt(
    items: GoogleSearchItem[],
    candidate: candidate & { sources: candidate_source[] },
  ): string {
    const knownCandidate = {
      name: [candidate.first_name, candidate.last_name]
        .filter(Boolean)
        .join(' '),
      current_title: candidate.current_title,
      current_company: candidate.current_company,
      known_sources: candidate.sources.map((source) => ({
        name: source.source,
        url: source.url,
      })),
    };

    const results = items.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      description: (item.pagemap as any)?.metatags?.[0]?.[
        'og:description'
      ] as string,
      page_content: item.page_content,
      image: this.extractImageUrl(item),
    }));

    return [
      'You are building out a deeper profile for a specific candidate already identified below, using additional search results found about them.',
      'Extract any new details you can find (contact info, location, work authorization, salary, skills, languages, education, a short bio) from the results below.',
      'When a result includes "page_content", it is the fetched text of the profile page itself — it is more reliable and complete than "snippet"/"description" (which are just a search engine\'s short summary), so prefer it as your primary source when present.',
      'When a result includes an "image" URL, copy it verbatim into "image_url" — do not fabricate one when it is absent.',
      'Do not guess contact details (email, phone) unless they literally appear in the text.',
      'Also extract every distinct employment history entry you can find into "experience": company_name and role are required for each entry; include start_date/end_date (ISO dates, approximate if only a year is known) and responsibilities/skills when available.',
      `Also extract every distinct education history entry you can find into "education": institution_name and institution_type (one of ${Object.values(InstitutionType).join(', ')}) are required for each entry; include institution_location/degree/field_of_study/start_date/end_date (ISO dates, approximate if only a year is known) when available.`,
      'List any newly-found platforms in "additional_sources" as objects with "title" (a short label for the source, e.g. the platform name or the page title), "name" (the platform name, e.g. "GitHub"), and "url" (the profile link, if found) — do not repeat sources already known.',
      'Only include a field when you have real evidence for it in the text below — omit anything you are not confident about.',
      '',
      `Known candidate: ${JSON.stringify(knownCandidate)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
    ].join('\n');
  }

  private buildExpandSearchTermsPrompt(
    seeds: ExpansionSeeds,
    roleName: string,
  ): string {
    return [
      'You are helping a recruiter write Boolean x-ray searches (Google "site:" searches over public profiles) that find unusual, high-potential candidates.',
      'For every seed below, return one group with "category" and "seed" copied verbatim from the input, and "terms": the seed itself first, then alternative phrasings a real person would put on their profile or CV for the same thing.',
      'Include nuanced, adjacent signals, not only synonyms: e.g. the job title "founder" -> ["founder", "co-founder", "entrepreneur", "startup", "side hustle"].',
      'Stay in the same industry and seniority as the seed and the role. Each term is a word or short phrase people actually write (no Boolean operators, no quotes, no company names, no generic single words like "manager", "experience" or "professional" on their own).',
      `At most ${MAX_TERMS_PER_SEED} terms per seed including the seed, each at most ${MAX_TERM_LENGTH} characters. Return a group for every seed, even when the seed is the only good term.`,
      '',
      `Role: ${JSON.stringify(roleName)}`,
      `Seeds: ${JSON.stringify(seeds)}`,
    ].join('\n');
  }

  // Lays out the exact category/child vocabulary role-filter-parser.ts
  // already knows how to read, so the model's output can be persisted as
  // real role_filter_item/role_filter_child rows with zero translation.
  private buildJobSpecPrompt(text: string): string {
    return [
      'You are extracting structured recruiting filter criteria from a job specification document, for a recruiter to review and edit before it is used to search for candidates.',
      'Return a list of "items", each with a fixed "category" (one of: location, job_titles, skills, languages, industry, companies, education, experience), a "priority" ("ESSENTIAL" if the spec treats it as a hard requirement, otherwise "OPTIONAL"), and "non_negotiable" (true only when the spec explicitly says a candidate must have this, e.g. "must have the right to work in the UK").',
      'Each item has either a scalar "value" or a "list_value" array, depending on category, and may carry "children" — open-ended sub-facts, each with a "title" and one of "value"/"list_value"/"boolean_value":',
      '- "location": value = the country as an ISO 3166-1 alpha-2 code (e.g. "GB"); children may include region entries (title = the region type such as "city" or "province", value = the region name), a "work_types" child (list_value = how the role may be worked, any of "ONSITE", "HYBRID", "REMOTE"; include "REMOTE" only if remote work is acceptable, and omit the child if the spec does not say), and a "work_authorization" child (boolean_value = true if the spec requires existing right-to-work).',
      '- "job_titles": list_value = the job title(s). Produce at most one item for the main/primary title (no children needed), and optionally a second item for alternative/equivalent titles the spec also mentions, with a child {"title": "title_option", "value": "alternative_title"}.',
      '- "skills": list_value = the required/preferred skills, as separate items split by priority (one ESSENTIAL item for must-have skills, one OPTIONAL item for nice-to-have skills), not as a single mixed list.',
      '- "languages": list_value = spoken/written languages required or preferred.',
      '- "industry": value = the industry or sector, as free text (e.g. "fintech").',
      '- "companies": list_value = company names mentioned as a target or exclusion; a child {"title": "company_type", "value": "include"} or {"value": "exclude"} records which.',
      '- "education": list_value = required/preferred qualifications (e.g. "Bachelor\'s degree"); a child {"title": "institutions", "list_value": [...]} when specific institutions are named, and {"title": "type", "value": "include"} or "exclude".',
      '- "experience": value = the minimum years of experience required, as a plain number string (e.g. "5") — omit this item entirely if the spec gives no numeric experience requirement.',
      'Only include an item when the spec actually gives real signal for it — do not invent or guess values that are not supported by the text.',
      '',
      `Job spec: ${text}`,
    ].join('\n');
  }
}

@Injectable()
export class GeminiService extends AiSdkReasoningProvider {
  readonly id = 'google' as const;
  readonly defaultModel = GEMINI_MODEL;
  // An org on a Gemini model researches with that model end to end.
  protected readonly groundsWithOwnModel = true;

  constructor(
    @Inject(AiConfig.KEY)
    aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'vertexProjectId' | 'vertexServiceAccount' | 'vertexAiLocation'
    >,
  ) {
    super(aiConf);
  }

  // Vertex project + service account are required config.
  get enabled(): boolean {
    return true;
  }

  protected async createModel(modelId: string): Promise<LanguageModel> {
    const vertex = await this.getVertex();
    return vertex(modelId);
  }

  protected callSettings(
    modelId: string,
    { fast }: { fast: boolean },
  ): ProviderCallSettings {
    return fast ? { providerOptions: noThinking(modelId) } : {};
  }
}
