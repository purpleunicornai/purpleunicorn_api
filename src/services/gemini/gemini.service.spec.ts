import { GeminiService } from './gemini.service';
import { RoleFilterDto } from '../../common/dto/search.dto';
import { GoogleSearchItem } from '../google-search/google-search.service';

function buildDto(overrides: Partial<RoleFilterDto> = {}): RoleFilterDto {
  return {
    uid: 'search-1',
    created: '2026-08-23T07:56:51.913Z',
    updated: '2026-08-23T07:56:51.913Z',
    role_id: 'role-1',
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
    education_universities: [],
    education_excluded_universities: [],
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

function buildItem(overrides: Partial<GoogleSearchItem> = {}): GoogleSearchItem {
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
    createGoogleGenerativeAI = jest.fn(
      () => (modelId: string) => ({ modelId, provider: 'google' }),
    );

    service = new GeminiService({ geminiApiKey: 'test-gemini-key' });
    jest.spyOn(service as any, 'loadAi').mockResolvedValue({
      generateText,
      Output: { array: jest.fn((spec: unknown) => spec) },
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

    it('parses the matches and token usage from the response', async () => {
      const matches = [
        {
          candidate: {
            main_source: 'LinkedIn',
            first_name: 'Jane',
            last_name: 'Doe',
            original_source_url: 'https://www.linkedin.com/in/janedoe',
            sources: ['LinkedIn'],
          },
          summary: 'Strong TypeScript background matching the role.',
          score: 82,
        },
      ];
      generateText.mockResolvedValue({ output: matches, usage: { totalTokens: 456 } });

      const result = await service.formatCandidates([buildItem()], buildDto());

      expect(result).toEqual({ matches, tokensUsed: 456 });
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
});
