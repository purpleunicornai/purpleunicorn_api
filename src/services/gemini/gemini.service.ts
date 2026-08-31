import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { RoleFilterDto } from '../../roles/dto/role_filter.dto';
import { GoogleSearchItem } from '../google-search/google-search.service';

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
  previous_companies: z.array(z.string()).optional(),
  previous_titles: z.array(z.string()).optional(),
  current_salary: z.number().optional(),
  current_salary_currency: z.string().optional(),
  current_role_start_date: z.string().optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  diversity: z.array(z.string()).optional(),
  education_levels: z.array(z.string()).optional(),
  education_universities: z.array(z.string()).optional(),
  graduation_years: z.array(z.string()).optional(),
  summary: z.string().optional(),
  image_url: z.string().optional(),
  original_source_url: z.string(),
  sources: z.array(z.string()),
});

const matchSchema = z.object({
  candidate: candidateSchema,
  summary: z.string(),
  score: z.number().int().min(0).max(100),
});

export type GeminiCandidateFields = z.infer<typeof candidateSchema>;
export type GeminiCandidateMatch = z.infer<typeof matchSchema>;

export interface FormatCandidatesResult {
  matches: GeminiCandidateMatch[];
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
    }));

    return [
      'You are extracting structured candidate profile data from Google search results for a recruiting pipeline.',
      'For each search result below, extract as much candidate information as you can infer from its title, link, snippet, and description.',
      'Set "main_source" to the platform the result came from (e.g. "LinkedIn"), "original_source_url" to the result\'s link, and "sources" to an array containing the main_source.',
      'Do not guess contact details (email, phone) unless they literally appear in the text.',
      'Then compare the candidate against the role criteria below: write a short "summary" explaining how well they match, and a "score" from 0-100 rating the overall match quality.',
      '',
      `Role criteria: ${JSON.stringify(criteria)}`,
      '',
      `Search results: ${JSON.stringify(results)}`,
    ].join('\n');
  }
}
