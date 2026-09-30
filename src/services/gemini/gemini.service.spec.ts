import { GeminiService } from './gemini.service';
import { RoleFilterDto } from '../../roles/dto/role_filter.dto';
import { GoogleSearchItem } from '../google-search/google-search.service';
import { candidate, candidate_source } from '../../generated/prisma/client';

type CandidateWithSources = candidate & { sources: candidate_source[] };

function buildSource(
  overrides: Partial<candidate_source> = {},
): candidate_source {
  return {
    uid: 'source-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    title: 'Jane Doe - Software Engineer - LinkedIn',
    source: 'LinkedIn',
    url: 'https://www.linkedin.com/in/janedoe',
    candidate_id: 'candidate-1',
    main: true,
    type: 'SEARCH',
    ...overrides,
  };
}

function buildCandidate(
  overrides: Partial<CandidateWithSources> = {},
): CandidateWithSources {
  return {
    uid: 'candidate-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    first_name: 'Jane',
    last_name: 'Doe',
    email: null,
    phone: null,
    country_calling_code: null,
    contact_info_last_updated: null,
    rocketreach_profile_id: null,
    current_location_city: null,
    current_location_country_code: null,
    current_location_postal_code: null,
    open_to_relocation: null,
    open_to_remote_work: null,
    current_work_authorization_status: null,
    experience_years: null,
    experience_roles: [],
    current_title: null,
    current_company: null,
    current_salary: null,
    current_salary_currency: null,
    current_role_start_date: null,
    skills: [],
    languages: [],
    diversity: [],
    summary: null,
    image_url: null,
    enriched_at: null,
    sources: [buildSource()],
    ...overrides,
  };
}

function buildDto(overrides: Partial<RoleFilterDto> = {}): RoleFilterDto {
  return {
    title: 'Software Engineer',
    alternative_titles: [],
    title_levels: [],
    roles: [],
    current_role_min_yrs: 0,
    current_role_max_yrs: 0,
    current_role_tenure_yrs: 0,
    country_code: 'US',
    remote_work: false,
    work_authorization_required: false,
    filter_location_cities: [],
    experience_min_yrs: 0,
    experience_max_yrs: 0,
    required_skills: [],
    optional_skills: [],
    education_levels: [],
    education_institution: [],
    education_excluded_institutions: [],
    education_graduation_min_yr: null,
    education_graduation_max_yr: null,
    required_languages: [],
    optional_languages: [],
    career_growth: [],
    security_clearance_required: [],
    diversity: [],
    other_experience: [],
    sites: [],
    filter_companies: [],
    metadata: { original_prompt: '', refined_prompt: '', complete: false },
    ...overrides,
  };
}

function buildItem(
  overrides: Partial<GoogleSearchItem> = {},
): GoogleSearchItem {
  return {
    title: 'Jane Doe - Software Engineer - LinkedIn',
    link: 'https://www.linkedin.com/in/janedoe',
    snippet: 'Software Engineer with 5 years of TypeScript experience.',
    ...overrides,
  };
}

describe('GeminiService', () => {
  let service: GeminiService;
  let generateText: jest.Mock;
  let createGoogleGenerativeAI: jest.Mock;

  beforeEach(() => {
    generateText = jest.fn();
    createGoogleGenerativeAI = jest.fn(() => (modelId: string) => ({
      modelId,
      provider: 'google',
    }));

    service = new GeminiService({ geminiApiKey: 'test-gemini-key' });
    jest.spyOn(service as any, 'loadAi').mockResolvedValue({
      generateText,
      Output: {
        array: jest.fn((spec: unknown) => spec),
        object: jest.fn((spec: unknown) => spec),
      },
    });
    jest
      .spyOn(service as any, 'loadGoogleProvider')
      .mockResolvedValue({ createGoogleGenerativeAI });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('formatCandidates', () => {
    it('returns an empty result without calling the model when there are no items', async () => {
      const result = await service.formatCandidates([], buildDto());

      expect(generateText).not.toHaveBeenCalled();
      expect(result).toEqual({ matches: [], tokensUsed: 0 });
    });

    it('calls generateText with the configured model and a prompt describing the results and role criteria', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      const dto = buildDto({ title: 'Fullstack Developer' });
      await service.formatCandidates([buildItem()], dto);

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ modelId: 'gemini-2.5-flash' }),
          prompt: expect.stringContaining('Fullstack Developer'),
          output: expect.anything(),
        }),
      );
    });

    it('includes an og:image URL from the result pagemap in the prompt, when present', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      const item = buildItem({
        pagemap: {
          metatags: [
            { 'og:image': 'https://media.licdn.com/dms/image/jane-og.jpg' },
          ],
        },
      } as any);
      await service.formatCandidates([item], buildDto());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'https://media.licdn.com/dms/image/jane-og.jpg',
          ),
        }),
      );
    });

    it('falls back to the pagemap cse_image when there is no og:image metatag', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      const item = buildItem({
        pagemap: {
          cse_image: [
            { src: 'https://media.licdn.com/dms/image/jane-cse.jpg' },
          ],
        },
      } as any);
      await service.formatCandidates([item], buildDto());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'https://media.licdn.com/dms/image/jane-cse.jpg',
          ),
        }),
      );
    });

    it('parses the matches and token usage from the response', async () => {
      const matches = [
        {
          candidate: {
            source_title: 'Jane Doe - Software Engineer - LinkedIn',
            source_name: 'LinkedIn',
            source_url: 'https://www.linkedin.com/in/janedoe',
            first_name: 'Jane',
            last_name: 'Doe',
          },
          summary: 'Strong TypeScript background matching the role.',
          reasoning:
            'Matches on required TypeScript skill and location, missing one optional skill.',
          skills_matched: ['TypeScript'],
          score: 82,
        },
      ];
      generateText.mockResolvedValue({
        output: matches,
        usage: { totalTokens: 456 },
      });

      const result = await service.formatCandidates([buildItem()], buildDto());

      expect(result).toEqual({ matches, tokensUsed: 456 });
    });

    it('asks the model for source_title, source_name, and source_url', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      await service.formatCandidates([buildItem()], buildDto());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/source_title/),
        }),
      );
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/source_name/),
        }),
      );
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/source_url/),
        }),
      );
    });

    it('asks the model for reasoning and skills_matched alongside the summary and score', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      await service.formatCandidates([buildItem()], buildDto());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/reasoning/i),
        }),
      );
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/skills_matched/i),
        }),
      );
    });

    it('defaults tokensUsed to 0 when usage.totalTokens is undefined', async () => {
      generateText.mockResolvedValue({
        output: [],
        usage: { totalTokens: undefined },
      });

      const result = await service.formatCandidates([buildItem()], buildDto());

      expect(result.tokensUsed).toBe(0);
    });

    it('only constructs the model once across multiple calls', async () => {
      generateText.mockResolvedValue({ output: [], usage: { totalTokens: 0 } });

      await service.formatCandidates([buildItem()], buildDto());
      await service.formatCandidates([buildItem()], buildDto());

      expect(createGoogleGenerativeAI).toHaveBeenCalledTimes(1);
    });
  });

  describe('enrichCandidate', () => {
    it('returns an empty enrichment without calling the model when there are no items', async () => {
      const result = await service.enrichCandidate([], buildCandidate());

      expect(generateText).not.toHaveBeenCalled();
      expect(result).toEqual({ enrichment: {}, tokensUsed: 0 });
    });

    it('calls generateText with the configured model and a prompt describing the candidate identity and results', async () => {
      generateText.mockResolvedValue({ output: {}, usage: { totalTokens: 0 } });

      const candidate = buildCandidate({
        first_name: 'Jane',
        last_name: 'Doe',
      });
      await service.enrichCandidate([buildItem()], candidate);

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ modelId: 'gemini-2.5-flash' }),
          prompt: expect.stringContaining('Jane Doe'),
          output: expect.anything(),
        }),
      );
    });

    it('includes an image URL from the result pagemap in the prompt, when present', async () => {
      generateText.mockResolvedValue({ output: {}, usage: { totalTokens: 0 } });

      const item = buildItem({
        pagemap: {
          metatags: [
            { 'og:image': 'https://media.licdn.com/dms/image/jane-og.jpg' },
          ],
        },
      } as any);
      await service.enrichCandidate([item], buildCandidate());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'https://media.licdn.com/dms/image/jane-og.jpg',
          ),
        }),
      );
    });

    it('includes fetched page_content in the prompt and prefers it over the snippet', async () => {
      generateText.mockResolvedValue({ output: {}, usage: { totalTokens: 0 } });

      const item = buildItem({
        page_content:
          'Jane Doe Senior Engineer at Acme 2019-Present. BSc Computer Science, Oxford 2015-2019.',
      });
      await service.enrichCandidate([item], buildCandidate());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'BSc Computer Science, Oxford 2015-2019',
          ),
        }),
      );
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/page_content.*more reliable/is),
        }),
      );
    });

    it('parses the enrichment fields and token usage from the response', async () => {
      const enrichment = {
        email: 'jane.doe@example.com',
        skills: ['TypeScript', 'NestJS'],
        additional_sources: [
          {
            title: 'Jane Doe - GitHub',
            name: 'GitHub',
            url: 'https://github.com/janedoe',
          },
        ],
        experience: [
          {
            company_name: 'TechCorp',
            role: 'Senior Engineer',
            start_date: '2021-01-01',
          },
        ],
        education: [
          {
            institution_name: 'University of Oxford',
            institution_type: 'UNIVERSITY',
            degree: "Bachelor's Degree",
            field_of_study: 'Computer Science',
            start_date: '2016-09-01',
            end_date: '2020-06-18',
          },
        ],
      };
      generateText.mockResolvedValue({
        output: enrichment,
        usage: { totalTokens: 321 },
      });

      const result = await service.enrichCandidate(
        [buildItem()],
        buildCandidate(),
      );

      expect(result).toEqual({ enrichment, tokensUsed: 321 });
    });

    it('asks the model to extract education history alongside experience', async () => {
      generateText.mockResolvedValue({ output: {}, usage: { totalTokens: 0 } });

      await service.enrichCandidate([buildItem()], buildCandidate());

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/institution_name/i),
        }),
      );
    });

    it('includes the known source names and URLs in the prompt so they are not re-discovered', async () => {
      generateText.mockResolvedValue({ output: {}, usage: { totalTokens: 0 } });

      const candidate = buildCandidate({
        sources: [
          buildSource({
            source: 'LinkedIn',
            url: 'https://linkedin.com/in/janedoe',
          }),
        ],
      });
      await service.enrichCandidate([buildItem()], candidate);

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('https://linkedin.com/in/janedoe'),
        }),
      );
    });

    it('defaults tokensUsed to 0 when usage.totalTokens is undefined', async () => {
      generateText.mockResolvedValue({
        output: {},
        usage: { totalTokens: undefined },
      });

      const result = await service.enrichCandidate(
        [buildItem()],
        buildCandidate(),
      );

      expect(result.tokensUsed).toBe(0);
    });
  });
});
