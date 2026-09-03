import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { RoleFilterDto } from '../../roles/dto/role_filter.dto';
import { GoogleSearchItem } from '../google-search/google-search.service';
import { candidate } from '../../generated/prisma/client';
import { InstitutionType } from '../../generated/prisma/enums';

const GEMINI_MODEL = 'gemini-2.5-flash';

const candidateSchema = z.object({
  main_source: z.string(),
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
  original_source_url: z.string(),
  sources: z.array(z.string()),
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

// Unlike candidateSchema (used when creating a brand new candidate record
// from a role search), this describes new facts to merge onto an already-
// known candidate, so it omits the identity fields (main_source,
// original_source_url, sources) that only make sense for a fresh record.
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
  additional_sources: z.array(z.string()).optional(),
  experience: z.array(candidateExperienceEnrichmentSchema).optional(),
  education: z.array(candidateEducationEnrichmentSchema).optional(),
});

export type GeminiCandidateExperienceEnrichment = z.infer<
  typeof candidateExperienceEnrichmentSchema
>;
export type GeminiCandidateEducationEnrichment = z.infer<
  typeof candidateEducationEnrichmentSchema
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
    dto: RoleFilterDto,
  ): Promise<FormatCandidatesResult> {
    if (items.length === 0) return { matches: [], tokensUsed: 0 };

    this.logger.debug(
      `Formatting ${items.length} search result(s) with Gemini`,
    );

    const { generateText, Output } = await this.loadAi();
    const model = await this.getModel();

    const { output, usage } = await generateText({
      model,
      prompt: this.buildPrompt(items, dto),
      output: Output.array({ element: matchSchema }),
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
    candidate: candidate,
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const pagemap = item.pagemap as any;
    return (
      pagemap?.metatags?.[0]?.['og:image'] ??
      pagemap?.cse_image?.[0]?.src ??
      pagemap?.cse_thumbnail?.[0]?.src
    );
  }

  private buildPrompt(items: GoogleSearchItem[], dto: RoleFilterDto): string {
    const criteria = {
      title: dto.title,
      alternative_titles: dto.alternative_titles,
      required_skills: dto.required_skills,
      optional_skills: dto.optional_skills,
      locations: dto.filter_location_cities.map((city) => city.name),
      experience_min_yrs: dto.experience_min_yrs,
      experience_max_yrs: dto.experience_max_yrs,
      education_levels: dto.education_levels,
      required_languages: dto.required_languages,
    };

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
      'Set "main_source" to the platform the result came from (e.g. "LinkedIn"), "original_source_url" to the result\'s link, and "sources" to an array containing the main_source.',
      'When a result includes an "image" URL, copy it verbatim into "image_url" — do not fabricate one when it is absent.',
      'Do not guess contact details (email, phone) unless they literally appear in the text.',
      'Then compare the candidate against the role criteria below: write a short "summary" explaining how well they match, a more detailed "reasoning" for that assessment, a "skills_matched" array listing which required/optional skills they actually have evidence of, and a "score" from 0-100 rating the overall match quality.',
      '',
      `Role criteria: ${JSON.stringify(criteria)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
    ].join('\n');
  }

  private buildEnrichmentPrompt(
    items: GoogleSearchItem[],
    candidate: candidate,
  ): string {
    const knownCandidate = {
      name: [candidate.first_name, candidate.last_name]
        .filter(Boolean)
        .join(' '),
      current_title: candidate.current_title,
      current_company: candidate.current_company,
      original_source_url: candidate.original_source_url,
      known_sources: candidate.sources,
    };

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
      'You are building out a deeper profile for a specific candidate already identified below, using additional search results found about them.',
      'Extract any new details you can find (contact info, location, work authorization, salary, skills, languages, education, a short bio) from the results below.',
      'When a result includes an "image" URL, copy it verbatim into "image_url" — do not fabricate one when it is absent.',
      'Do not guess contact details (email, phone) unless they literally appear in the text.',
      'Also extract every distinct employment history entry you can find into "experience": company_name and role are required for each entry; include start_date/end_date (ISO dates, approximate if only a year is known) and responsibilities/skills when available.',
      `Also extract every distinct education history entry you can find into "education": institution_name and institution_type (one of ${Object.values(InstitutionType).join(', ')}) are required for each entry; include institution_location/degree/field_of_study/start_date/end_date (ISO dates, approximate if only a year is known) when available.`,
      'List any newly-found platform names (e.g. "GitHub", "Stack Overflow") in "additional_sources" — do not repeat sources already known.',
      'Only include a field when you have real evidence for it in the text below — omit anything you are not confident about.',
      '',
      `Known candidate: ${JSON.stringify(knownCandidate)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
    ].join('\n');
  }
}
