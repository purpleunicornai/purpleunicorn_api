import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { RoleFilterDto } from '../../common/dto/search.dto';
import { DEFAULT_XRAY_SITES } from '../../common/constants/google';

export interface GoogleSearchItem {
  title: string;
  link: string;
  snippet?: string;
  [key: string]: unknown;
}

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);
  public client: AxiosInstance;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'googleSearchApiKey' | 'googleSearchEngineId'
    >,
  ) {
    this.client = axios.create({ timeout: 20_000 });
  }

  async search(dto: RoleFilterDto): Promise<GoogleSearchItem[]> {
    const queries = this.buildXrayQueries(dto);
    this.logger.debug(`Running ${queries.length} Google x-ray query(s)`);

    const results = await Promise.all(
      queries.map((query) => this.searchQuery(query)),
    );

    return results.flat();
  }

  private async searchQuery(query: string): Promise<GoogleSearchItem[]> {
    const params = {
      key: this.aiConf.googleSearchApiKey,
      cx: this.aiConf.googleSearchEngineId,
      q: query,
    };
    const requestUrl = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams(params).toString()}`;

    this.logger.debug(`Running Google search: ${query}`);
    const response = await this.client.get(requestUrl);
    return response.data.items ?? [];
  }

  private buildSiteFilter(dto: RoleFilterDto): string {
    const sites = dto.sites?.length
      ? dto.sites.map((site) => `site:${site}`)
      : DEFAULT_XRAY_SITES;
    // A parenthesized single-term site: filter (e.g. "(site:linkedin.com/in)")
    // returns zero results from Google's Custom Search API — confirmed live.
    if (sites.length === 1) return sites[0];
    return `(${sites.join(' OR ')})`;
  }

  private buildXrayQueries(dto: RoleFilterDto): string[] {
    const siteFilter = this.buildSiteFilter(dto);
    const commonParts = [
      this.andClause(dto.required_skills),
      this.orClause(dto.optional_skills),
      this.orClause(dto.filter_location_cities.map((city) => city.name)),
    ];

    const queries = new Set<string>();
    queries.add(
      this.joinNonEmpty([siteFilter, this.quote(dto.title), ...commonParts]),
    );

    for (const alternativeTitle of dto.alternative_titles.slice(0, 3)) {
      queries.add(
        this.joinNonEmpty([
          siteFilter,
          this.quote(alternativeTitle),
          ...commonParts,
        ]),
      );
    }

    return [...queries].filter((query) => query.length > siteFilter.length);
  }

  private andClause(values: string[]): string {
    return values
      .map((value) => this.quote(value))
      .filter((value) => value.length > 0)
      .join(' ');
  }

  private orClause(values: string[]): string {
    const quoted = values
      .map((value) => this.quote(value))
      .filter((value) => value.length > 0);

    if (quoted.length === 0) return '';
    if (quoted.length === 1) return quoted[0];
    return `(${quoted.join(' OR ')})`;
  }

  private quote(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.includes(' ') ? `"${trimmed}"` : trimmed;
  }

  private joinNonEmpty(parts: string[]): string {
    return parts.filter((part) => part && part.length > 0).join(' ');
  }
}
