import { AxiosError, type AxiosResponse } from 'axios';
import { personOf, RocketReachService } from './rocket-reach.service';

const lookupPerson = (
  service: RocketReachService,
  candidate: Parameters<RocketReachService['lookup']>[0],
) => service.lookup(candidate).then(personOf);
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

  describe('lookup', () => {
    it('returns undefined without calling the API when no usable identifier is available', async () => {
      const get = jest.spyOn(service.client, 'get');

      const result = await lookupPerson(service, buildCandidate());

      expect(get).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('looks up by rocketreach_profile_id when already known', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { id: 42, status: 'complete', name: 'Jane Doe' },
      });

      await lookupPerson(
        service,
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

      await lookupPerson(
        service,
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

      await lookupPerson(
        service,
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

      await lookupPerson(
        service,
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

      const result = await lookupPerson(
        service,
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

      const result = await lookupPerson(
        service,
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toEqual(person);
    });

    it('returns undefined when the lookup comes back not queued (no match found)', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: { status: 'not queued' },
      });

      const result = await lookupPerson(
        service,
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toBeUndefined();
    });

    it('returns undefined instead of throwing when the request fails', async () => {
      jest
        .spyOn(service.client, 'get')
        .mockRejectedValue(new Error('Request failed with status code 429'));

      const result = await lookupPerson(
        service,
        buildCandidate({ email: 'jane@example.com' }),
      );

      expect(result).toBeUndefined();
    });
  });
});

// Polls without waiting in real time.
class InstantRocketReachService extends RocketReachService {
  protected wait(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RocketReachService without an API key', () => {
  it.each([undefined, ''])(
    'is disabled with key %p, and a lookup resolves without calling the API',
    async (rocketReachApiKey) => {
      const service = new RocketReachService({ rocketReachApiKey });
      const get = jest.spyOn(service.client, 'get');

      expect(service.enabled).toBe(false);
      await expect(
        lookupPerson(service, buildCandidate({ sources: [buildSource()] })),
      ).resolves.toBeUndefined();
      expect(get).not.toHaveBeenCalled();
    },
  );
});

describe('RocketReachService lookups that are still in progress', () => {
  const candidate = () => buildCandidate({ sources: [buildSource()] });
  let service: InstantRocketReachService;

  beforeEach(() => {
    service = new InstantRocketReachService({ rocketReachApiKey: 'key' });
  });

  it('polls checkStatus until the profile completes', async () => {
    const get = jest
      .spyOn(service.client, 'get')
      .mockResolvedValueOnce({ data: { id: 7, status: 'searching' } })
      .mockResolvedValueOnce({ data: [{ id: 7, status: 'progress' }] })
      .mockResolvedValueOnce({
        data: [{ id: 7, status: 'complete', name: 'Jane Doe' }],
      });

    const person = await lookupPerson(service, candidate());

    expect(person).toEqual({ id: 7, status: 'complete', name: 'Jane Doe' });
    expect(get).toHaveBeenLastCalledWith(
      'https://api.rocketreach.co/api/v2/person/checkStatus',
      { params: { ids: '7' }, headers: { 'Api-Key': 'key' } },
    );
  });

  it('gives up (no profile, so nothing to charge) when it never completes', async () => {
    const get = jest
      .spyOn(service.client, 'get')
      .mockResolvedValueOnce({ data: { id: 7, status: 'waiting' } })
      .mockResolvedValue({ data: [{ id: 7, status: 'waiting' }] });

    await expect(lookupPerson(service, candidate())).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(5);
  });

  it('treats a failed lookup as no match', async () => {
    jest
      .spyOn(service.client, 'get')
      .mockResolvedValue({ data: { id: 7, status: 'failed' } });

    await expect(lookupPerson(service, candidate())).resolves.toBeUndefined();
  });
});

describe('RocketReachService lookup outcomes', () => {
  let service: InstantRocketReachService;
  const httpError = (status: number) =>
    new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status,
    } as AxiosResponse);

  beforeEach(() => {
    service = new InstantRocketReachService({ rocketReachApiKey: 'key' });
  });

  it('reports a find with the query it sent', async () => {
    jest
      .spyOn(service.client, 'get')
      .mockResolvedValue({ data: { id: 7, status: 'complete' } });

    await expect(
      service.lookup(buildCandidate({ sources: [buildSource()] })),
    ).resolves.toEqual({
      outcome: 'found',
      query: {
        type: 'linkedin_url',
        params: { linkedin_url: 'https://www.linkedin.com/in/janedoe' },
      },
      person: { id: 7, status: 'complete' },
    });
  });

  it.each([
    ['id', { rocketreach_profile_id: '9' }],
    ['email', { email: 'jane@example.com' }],
    ['name_employer', { current_company: 'Acme' }],
  ])('names the %s query type', async (type, overrides) => {
    jest.spyOn(service.client, 'get').mockRejectedValue(httpError(404));

    const result = await service.lookup(buildCandidate(overrides));

    expect(result).toMatchObject({ query: { type } });
  });

  it('reports a 404 as no match', async () => {
    jest.spyOn(service.client, 'get').mockRejectedValue(httpError(404));

    await expect(
      service.lookup(buildCandidate({ email: 'jane@example.com' })),
    ).resolves.toEqual({
      outcome: 'not_found',
      query: { type: 'email', params: { email: 'jane@example.com' } },
    });
  });

  it('reports a failed profile as no match, with its id', async () => {
    jest
      .spyOn(service.client, 'get')
      .mockResolvedValue({ data: { id: 7, status: 'failed' } });

    await expect(
      service.lookup(buildCandidate({ email: 'jane@example.com' })),
    ).resolves.toMatchObject({ outcome: 'not_found', profileId: 7 });
  });

  it('reports a server error with its status and code, not its message', async () => {
    jest.spyOn(service.client, 'get').mockRejectedValue(httpError(500));

    await expect(
      service.lookup(buildCandidate({ email: 'jane@example.com' })),
    ).resolves.toMatchObject({
      outcome: 'error',
      httpStatus: 500,
      error: 'ERR_BAD_RESPONSE',
    });
  });

  it('reports a lookup that never completes as timed out', async () => {
    jest
      .spyOn(service.client, 'get')
      .mockResolvedValueOnce({ data: { id: 7, status: 'searching' } })
      .mockResolvedValue({ data: [{ id: 7, status: 'searching' }] });

    await expect(
      service.lookup(buildCandidate({ email: 'jane@example.com' })),
    ).resolves.toMatchObject({ outcome: 'pending_timeout', profileId: 7 });
  });

  it('skips, without calling the API, when disabled or with nothing to go on', async () => {
    const get = jest.spyOn(service.client, 'get');

    await expect(service.lookup(buildCandidate())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'no_identifier',
    });
    await expect(
      new RocketReachService({ rocketReachApiKey: '' }).lookup(
        buildCandidate({ email: 'jane@example.com' }),
      ),
    ).resolves.toEqual({ outcome: 'skipped', reason: 'disabled' });
    expect(get).not.toHaveBeenCalled();
  });
});
