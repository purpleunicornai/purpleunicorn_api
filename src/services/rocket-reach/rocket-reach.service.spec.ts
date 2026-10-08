import { RocketReachService } from './rocket-reach.service';
import { candidate, candidate_source } from '../../generated/prisma/client';

type CandidateWithSources = candidate & { sources: candidate_source[] };

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
    sources: [],
    ...overrides,
  };
}

function buildSource(
  overrides: Partial<candidate_source> = {},
): candidate_source {
  return {
    uid: 'source-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    title: 'Jane Doe - LinkedIn',
    source: 'LinkedIn',
    url: 'https://www.linkedin.com/in/janedoe',
    candidate_id: 'candidate-1',
    main: true,
    type: 'SEARCH',
    ...overrides,
  };
}

describe('RocketReachService', () => {
  let service: RocketReachService;

  beforeEach(() => {
    service = new RocketReachService({ rocketReachApiKey: 'test-api-key' });
  });

  describe('lookupCandidate', () => {
    it('returns undefined without calling the API when no usable identifier is available', async () => {
      const get = jest.spyOn(service.client, 'get');

      const result = await service.lookupCandidate(buildCandidate());

      expect(get).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('looks up by rocketreach_profile_id when already known', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { id: 42, status: 'complete', name: 'Jane Doe' },
      });

      await service.lookupCandidate(
        buildCandidate({
          rocketreach_profile_id: '42',
          // A known profile id should take priority over every other identifier.
          email: 'jane@example.com',
          sources: [buildSource()],
        }),
      );

      expect(service.client.get).toHaveBeenCalledWith(
        'https://api.rocketreach.co/api/v2/person/lookup',
        {
          params: { id: '42' },
          headers: { 'Api-Key': 'test-api-key' },
        },
      );
    });

    it('looks up by the LinkedIn source URL when no profile id is known', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { id: 42, status: 'complete', name: 'Jane Doe' },
      });

      await service.lookupCandidate(
        buildCandidate({
          email: 'jane@example.com',
          sources: [
            buildSource({
              source: 'GitHub',
              url: 'https://github.com/janedoe',
            }),
            buildSource({
              source: 'LinkedIn',
              url: 'https://www.linkedin.com/in/janedoe',
            }),
          ],
        }),
      );

      expect(service.client.get).toHaveBeenCalledWith(
        'https://api.rocketreach.co/api/v2/person/lookup',
        {
          params: { linkedin_url: 'https://www.linkedin.com/in/janedoe' },
          headers: { 'Api-Key': 'test-api-key' },
        },
      );
    });

    it('looks up by email when no profile id or LinkedIn source is known', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { id: 42, status: 'complete', name: 'Jane Doe' },
      });

      await service.lookupCandidate(
        buildCandidate({
          email: 'jane@example.com',
          first_name: 'Jane',
          last_name: 'Doe',
          current_company: 'Acme',
        }),
      );

      expect(service.client.get).toHaveBeenCalledWith(
        'https://api.rocketreach.co/api/v2/person/lookup',
        {
          params: { email: 'jane@example.com' },
          headers: { 'Api-Key': 'test-api-key' },
        },
      );
    });

    it('falls back to name + current_employer as a last resort', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { id: 42, status: 'complete', name: 'Jane Doe' },
      });

      await service.lookupCandidate(
        buildCandidate({
          first_name: 'Jane',
          last_name: 'Doe',
          current_company: 'Acme',
        }),
      );

      expect(service.client.get).toHaveBeenCalledWith(
        'https://api.rocketreach.co/api/v2/person/lookup',
        {
          params: { name: 'Jane Doe', current_employer: 'Acme' },
          headers: { 'Api-Key': 'test-api-key' },
        },
      );
    });

    it('returns undefined without calling the API when only a name is known (no current_employer)', async () => {
      const get = jest.spyOn(service.client, 'get');

      const result = await service.lookupCandidate(
        buildCandidate({ first_name: 'Jane', last_name: 'Doe' }),
      );

      expect(get).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('returns the person data when the lookup succeeds', async () => {
      const person = {
        id: 42,
        status: 'complete',
        name: 'Jane Doe',
        linkedin_url: 'https://www.linkedin.com/in/janedoe',
        current_title: 'Senior Engineer',
        current_employer: 'Acme',
        recommended_email: 'jane@acme.com',
        emails: [{ email: 'jane@acme.com', type: 'professional' }],
        job_history: [
          { company_name: 'Acme', title: 'Senior Engineer', is_current: true },
        ],
      };
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: person });

      const result = await service.lookupCandidate(
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toEqual(person);
    });

    it('returns undefined when the lookup comes back not queued (no match found)', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { status: 'not queued' },
      });

      const result = await service.lookupCandidate(
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toBeUndefined();
    });

    it('returns undefined instead of throwing when the request fails', async () => {
      jest
        .spyOn(service.client, 'get')
        .mockRejectedValue(new Error('Request failed with status code 429'));

      const result = await service.lookupCandidate(
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toBeUndefined();
    });
  });
});
