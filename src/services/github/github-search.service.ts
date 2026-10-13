import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { GoogleSearchItem } from '../google-search/google-search.service';

interface GithubUser {
  id: number | string;
  login: string;
  bio?: string | null;
  html_url: string;
  avatar_url?: string;
}

const RESULTS_PER_PAGE = 30;

// A second, genuinely independent candidate source alongside Google x-ray —
// GitHub's own profile data rather than whatever Google's index happened to
// crawl of a site. Returns the same GoogleSearchItem shape Google results
// use, so it plugs into the rest of the search pipeline (Gemini extraction,
// upsertCandidate dedup by source_url) with no further special-casing.
@Injectable()
export class GithubSearchService {
  private readonly logger = new Logger(GithubSearchService.name);
  public client: AxiosInstance;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<ConfigType<typeof AiConfig>, 'githubToken'>,
  ) {
    this.client = axios.create({ timeout: 20_000 });
  }

  // Never throws — GitHub is a supplementary source, so a rate limit, auth
  // failure, or network error should just mean "no GitHub results this
  // run," not fail the whole search.
  async search(filters: ParsedRoleFilters): Promise<GoogleSearchItem[]> {
    const query = this.buildQuery(filters);
    if (!query) return [];

    try {
      this.logger.debug(`Running GitHub user search: ${query}`);
      const response = await this.client.get<{ items?: GithubUser[] }>(
        'https://api.github.com/search/users',
        {
          params: { q: query, per_page: RESULTS_PER_PAGE },
          headers: this.buildHeaders(),
        },
      );
      return (response.data.items ?? []).map((user) => this.toSearchItem(user));
    } catch (error) {
      this.logger.debug(
        `GitHub search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
    };
    if (this.aiConf.githubToken) {
      headers.Authorization = `token ${this.aiConf.githubToken}`;
    }
    return headers;
  }

  // GitHub's Search Users API takes qualifiers (location:) rather than
  // boolean/quoted syntax, so this is deliberately simpler than
  // GoogleSearchService.buildXrayQueries. Returns undefined — rather than
  // falling back to a generic term — when the role has neither a title nor
  // a skill, since a search with no real signal isn't worth the API call.
  private buildQuery(filters: ParsedRoleFilters): string | undefined {
    const mainTitle = filters.jobTitles.find(
      (row) => row.value.option === 'main_title',
    )?.value.titles[0];
    const topSkill = filters.skills.flatMap((row) => row.value)[0];

    const terms: string[] = [];
    let skillUsedAsPrimary = false;
    if (mainTitle) {
      terms.push(`"${mainTitle}"`);
    } else if (topSkill) {
      terms.push(topSkill);
      skillUsedAsPrimary = true;
    } else {
      return undefined;
    }

    const locationTerm = this.buildLocationTerm(filters);
    if (locationTerm) terms.push(locationTerm);

    if (topSkill && !skillUsedAsPrimary && terms.length < 2) {
      terms.push(topSkill);
    }

    return terms.join(' ');
  }

  // Best-effort: GitHub's location: qualifier matches free text against a
  // user's self-reported location, so this needs a human-readable place
  // name — the parsed countryCode (an ISO code) won't match profile text,
  // so only a region entry (the first one, whatever it is) is used.
  private buildLocationTerm(filters: ParsedRoleFilters): string | undefined {
    if (!filters.location || filters.location.value.remoteWork) {
      return undefined;
    }
    const place = filters.location.value.regions[0]?.value;
    if (!place) return undefined;
    return `location:"${place}"`;
  }

  private toSearchItem(user: GithubUser): GoogleSearchItem {
    return {
      title: `${user.login} - GitHub`,
      link: user.html_url,
      snippet: user.bio ?? undefined,
      ...(user.avatar_url && {
        pagemap: { metatags: [{ 'og:image': user.avatar_url }] },
      }),
    };
  }
}
