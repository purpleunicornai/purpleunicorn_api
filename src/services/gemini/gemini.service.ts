import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { GoogleSearchItem } from '../google-search/google-search.service';
import { candidate, candidate_source } from '../../generated/prisma/client';
import { InstitutionType } from '../../generated/prisma/enums';

const GEMINI_MODEL = 'gemini-2.5-flash';

// Bounds a single generateText call so a stuck or abnormally slow request
// (e.g. an oversized batch) fails with a clear timeout error instead of
// hanging the caller indefinitely.
const GEMINI_CALL_TIMEOUT_MS = 120_000;

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
  score: z.number().int().min(0).max(100),
});

export type GeminiCandidateFields = z.infer<typeof candidateSchema>;
export type GeminiCandidateMatch = z.infer<typeof matchSchema>;

export interface FormatCandidatesResult {
  matches: GeminiCandidateMatch[];
  tokensUsed: number;
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

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private modelPromise: Promise<LanguageModel> | null = null;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<ConfigType<typeof AiConfig>, 'geminiApiKey'>,
  ) {}

  async formatCandidates(
    items: GoogleSearchItem[],
    filters: ParsedRoleFilters,
  ): Promise<FormatCandidatesResult> {
    if (items.length === 0) return { matches: [], tokensUsed: 0 };

    this.logger.debug(
      `Formatting ${items.length} search result(s) with Gemini`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel();

    const { output, usage } = await generateText({
      model,
      prompt: this.buildPrompt(items, filters),
      output: Output.array({ element: matchSchema }),
      timeout: GEMINI_CALL_TIMEOUT_MS,
      // This is scoring each candidate against fixed criteria, not
      // multi-step reasoning — disabling thinking measured ~25% faster
      // and cheaper with no observed quality loss.
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });

    return {
      matches: output,
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // Digs deeper on one already-identified candidate to build out their
  // profile — unlike formatCandidates, this isn't judging fit against a
  // role, just extracting whatever new facts the search results contain.
  async enrichCandidate(
    items: GoogleSearchItem[],
    candidate: candidate & { sources: candidate_source[] },
  ): Promise<EnrichCandidateResult> {
    if (items.length === 0) {
      return { enrichment: {}, tokensUsed: 0 };
    }

    this.logger.debug(
      `Enriching candidate profile from ${items.length} search result(s)`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel();

    const { output, usage } = await generateText({
      model,
      prompt: this.buildEnrichmentPrompt(items, candidate),
      output: Output.object({ schema: candidateEnrichmentSchema }),
    });

    return {
      enrichment: output,
      tokensUsed: usage.totalTokens ?? 0,
    };
  }

  // ai / @ai-sdk/google are ESM-only (no CJS build). This project is
  // CommonJS, so a static import would compile to require() and crash at
  // runtime with ERR_REQUIRE_ESM — dynamic import() is Node's documented
  // way for CJS code to load an ESM-only package. Kept as their own
  // methods (rather than inline) so tests can override them directly —
  // Jest's VM test environment can't execute a real dynamic import()
  // without the experimental-vm-modules flag.
  private async loadAi() {
    return import('ai');
  }

  private async loadGoogleProvider() {
    return import('@ai-sdk/google');
  }

  private async getModel(): Promise<LanguageModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadGoogleProvider().then(
        ({ createGoogleGenerativeAI }) =>
          createGoogleGenerativeAI({ apiKey: this.aiConf.geminiApiKey })(
            GEMINI_MODEL,
          ),
      );
    }
    return this.modelPromise;
  }

  // Google's Custom Search API doesn't return a photo directly — it returns
  // pagemap metadata scraped from the page, so a profile photo (when the
  // page exposes one) turns up as an og:image meta tag, a CSE-detected
  // image, or a thumbnail, roughly in that order of how likely it is to
  // actually be the person's photo rather than a site logo or icon.
  private extractImageUrl(item: GoogleSearchItem): string | undefined {
    const pagemap = item.pagemap as any;
    return (
      pagemap?.metatags?.[0]?.['og:image'] ??
      pagemap?.cse_image?.[0]?.src ??
      pagemap?.cse_thumbnail?.[0]?.src
    );
  }

  private buildPrompt(
    items: GoogleSearchItem[],
    filters: ParsedRoleFilters,
  ): string {
    const criteria = [
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
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
      })),
      ...(filters.location
        ? [
            {
              category: 'location',
              countryCode: filters.location.value.countryCode,
              regions: filters.location.value.regions,
              remoteWork: filters.location.value.remoteWork,
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
      'Then compare the candidate against the role criteria below: each criterion has a "priority" ("ESSENTIAL" or "OPTIONAL") and a "nonNegotiable" flag — weigh ESSENTIAL and non-negotiable criteria most heavily. Write a short "summary" explaining how well they match, a more detailed "reasoning" for that assessment, a "skills_matched" array listing which required/optional skills they actually have evidence of, and a "score" from 0-100 rating the overall match quality.',
      '',
      `Role criteria: ${JSON.stringify(criteria)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
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
}
