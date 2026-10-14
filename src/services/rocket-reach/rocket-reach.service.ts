import { Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import AiConfig from '../../config/ai.config';
import type { ConfigType } from '@nestjs/config';
import { candidate, candidate_source } from '../../generated/prisma/client';

const LOOKUP_URL = 'https://api.rocketreach.co/api/v2/person/lookup';

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
  status: 'complete' | 'progress' | 'searching' | 'not queued' | string;
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
  recommended_email?: string;
  emails?: RocketReachEmail[];
  phones?: RocketReachPhone[];
  job_history?: RocketReachJobHistoryEntry[];
  education?: RocketReachEducationEntry[];
  skills?: string[];
}

type CandidateWithSources = candidate & { sources: candidate_source[] };

@Injectable()
export class RocketReachService {
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

  // Looks a candidate up on RocketReach using the most precise identifier
  // already known about them, so a repeat lookup or a candidate with a
  // verified LinkedIn profile doesn't fall back to a fuzzy name match.
  // Never throws — a missing identifier, "not queued" (no match), or any
  // request failure (auth, rate limit, network) all resolve to undefined.
  async lookupCandidate(
    candidate: CandidateWithSources,
  ): Promise<RocketReachPerson | undefined> {
    const params = this.buildLookupParams(candidate);
    if (!params) return undefined;

    try {
      console.log('RocketReach lookup params:', params);
      const response = await this.client.get<RocketReachPerson>(LOOKUP_URL, {
        params,
        headers: { 'Api-Key': this.aiConf.rocketReachApiKey },
      });
      if (response.data.status === 'not queued') return undefined;
      return response.data;
    } catch (error) {
      this.logger.debug(
        `RocketReach lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
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
