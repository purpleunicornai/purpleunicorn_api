import { Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import AiConfig from '../../config/ai.config';
import type { ConfigType } from '@nestjs/config';
import { candidate, candidate_source } from '../../generated/prisma/client';

const API_URL = 'https://api.rocketreach.co/api/v2';
// A lookup RocketReach hasn't finished yet is polled this many times, this
// far apart, before giving up (a lookup that never completes isn't charged).
const STATUS_POLLS = 4;
const STATUS_POLL_INTERVAL_MS = 1_500;
const PENDING_STATUSES = new Set(['waiting', 'searching', 'progress']);

export interface RocketReachEmail {
  email: string;
  smtp_valid?: string;
  type?: string;
  grade?: string;
}

export interface RocketReachPhone {
  number: string;
  e164?: string;
  type?: string;
  recommended?: boolean;
}

export interface RocketReachJobHistoryEntry {
  company_name?: string;
  company?: string;
  title?: string;
  department?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  description?: string;
}

export interface RocketReachEducationEntry {
  school?: string;
  degree?: string;
  major?: string;
  start?: number;
  end?: number;
}

export interface RocketReachPerson {
  id: number;
  // complete, waiting, searching, progress, failed or not queued.
  status: string;
  name?: string;
  linkedin_url?: string;
  current_title?: string;
  current_employer?: string;
  current_employer_domain?: string;
  current_employer_website?: string;
  current_employer_linkedin_url?: string;
  location?: string;
  city?: string;
  region?: string;
  country?: string;
  // ISO 3166-1 alpha-2, e.g. "GB".
  country_code?: string;
  recommended_email?: string;
  emails?: RocketReachEmail[];
  phones?: RocketReachPhone[];
  job_history?: RocketReachJobHistoryEntry[];
  education?: RocketReachEducationEntry[];
  skills?: string[];
}

type CandidateWithSources = candidate & { sources: candidate_source[] };

// Which identifier a lookup sent, and the request parameters themselves.
export type RocketReachQuery = {
  type: 'id' | 'linkedin_url' | 'email' | 'name_employer';
  params: Record<string, string>;
};

export type RocketReachLookup =
  | { outcome: 'found'; query: RocketReachQuery; person: RocketReachPerson }
  | {
      outcome: 'not_found' | 'pending_timeout';
      query: RocketReachQuery;
      profileId?: number;
    }
  | {
      outcome: 'error';
      query: RocketReachQuery;
      httpStatus?: number;
      // An error name or code, never a message that could echo a response.
      error: string;
    }
  // Never sent: no API key, or nothing on file to look the person up by.
  | { outcome: 'skipped'; reason: 'disabled' | 'no_identifier' };

export const personOf = (
  lookup: RocketReachLookup | undefined,
): RocketReachPerson | undefined =>
  lookup?.outcome === 'found' ? lookup.person : undefined;

// The email and phone worth keeping from a profile: RocketReach's
// recommended ones first.
export function bestContactOf(person: RocketReachPerson): {
  email?: string;
  phone?: string;
} {
  return {
    email:
      person.recommended_email ??
      person.emails?.find((entry) => entry.email)?.email,
    phone:
      person.phones?.find((entry) => entry.recommended)?.number ??
      person.phones?.[0]?.number,
  };
}

const queryTypeOf = (
  params: Record<string, string>,
): RocketReachQuery['type'] =>
  params.id
    ? 'id'
    : params.linkedin_url
      ? 'linkedin_url'
      : params.email
        ? 'email'
        : 'name_employer';

// A person-lookup source for deep research. RocketReachService is the only
// one; specs stub this shape.
export interface PersonLookup {
  // False when no API key is configured: callers skip the lookup and never
  // quote or charge for it.
  readonly enabled: boolean;
  // Whether there's enough on file to look this candidate up at all.
  canLookUp(candidate: CandidateWithSources): boolean;
  lookup(candidate: CandidateWithSources): Promise<RocketReachLookup>;
}

@Injectable()
export class RocketReachService implements PersonLookup {
  private readonly logger = new Logger(RocketReachService.name);
  public client: AxiosInstance;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'rocketReachApiKey'
    >,
  ) {
    this.client = axios.create({ timeout: 20_000 });
  }

  get enabled(): boolean {
    return !!this.aiConf.rocketReachApiKey;
  }

  canLookUp(candidate: CandidateWithSources): boolean {
    return !!this.buildLookupParams(candidate);
  }

  // Overridden in specs so polling doesn't wait in real time.
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Looks a candidate up on RocketReach using the most precise identifier
  // already known about them, so a repeat lookup or a candidate with a
  // verified LinkedIn profile doesn't fall back to a fuzzy name match.
  // Never throws: every way it can end is an outcome. A lookup still
  // processing is polled a few times before it's reported as timed out.
  async lookup(candidate: CandidateWithSources): Promise<RocketReachLookup> {
    if (!this.enabled) return { outcome: 'skipped', reason: 'disabled' };
    const params = this.buildLookupParams(candidate);
    if (!params) return { outcome: 'skipped', reason: 'no_identifier' };
    const query = { type: queryTypeOf(params), params };

    const headers = { 'Api-Key': this.aiConf.rocketReachApiKey };
    try {
      let { data: person } = await this.client.get<RocketReachPerson>(
        `${API_URL}/person/lookup`,
        { params, headers },
      );
      for (
        let poll = 0;
        poll < STATUS_POLLS && PENDING_STATUSES.has(person.status);
        poll++
      ) {
        await this.wait(STATUS_POLL_INTERVAL_MS);
        const { data } = await this.client.get<RocketReachPerson[]>(
          `${API_URL}/person/checkStatus`,
          { params: { ids: String(person.id) }, headers },
        );
        person = data.find((entry) => entry.id === person.id) ?? person;
      }
      if (person.status === 'complete') {
        return { outcome: 'found', query, person };
      }
      return {
        outcome: PENDING_STATUSES.has(person.status)
          ? 'pending_timeout'
          : 'not_found',
        query,
        profileId: person.id,
      };
    } catch (error) {
      const httpStatus = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      // RocketReach answers a lookup with no match as 404.
      if (httpStatus === 404) return { outcome: 'not_found', query };
      const code =
        (axios.isAxiosError(error) && error.code) ||
        (error instanceof Error ? error.name : 'unknown');
      this.logger.warn(`RocketReach lookup failed (${httpStatus ?? code})`);
      return { outcome: 'error', query, httpStatus, error: code };
    }
  }

  private buildLookupParams(
    candidate: CandidateWithSources,
  ): Record<string, string> | undefined {
    if (candidate.rocketreach_profile_id) {
      return { id: candidate.rocketreach_profile_id };
    }

    const linkedinUrl = candidate.sources.find((source) =>
      source.url?.toLowerCase().includes('linkedin.com'),
    )?.url;
    if (linkedinUrl) return { linkedin_url: linkedinUrl };

    if (candidate.email) return { email: candidate.email };

    const fullName = [candidate.first_name, candidate.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName && candidate.current_company) {
      return { name: fullName, current_employer: candidate.current_company };
    }

    return undefined;
  }
}
