import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { protos, SearchServiceClient } from '@google-cloud/discoveryengine';
import { type JWTInput } from 'google-auth-library';
import AiConfig from '../../config/ai.config';
import { RequestException } from '../../common/exception/core/ExceptionBase';

type SearchResult =
  protos.google.cloud.discoveryengine.v1.SearchResponse.ISearchResult;

export interface VertexSearchResult {
  results: SearchResult[];
  // Opaque token for the next page; absent once there are no more results.
  nextPageToken?: string;
  totalSize?: number;
}

const DEFAULT_COLLECTION_ID = 'default_collection';
const DEFAULT_PAGE_SIZE = 10;

@Injectable()
export class VertexService {
  private readonly logger = new Logger(VertexService.name);
  private readonly client: SearchServiceClient;
  private readonly servingConfig: string;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: ConfigType<typeof AiConfig>,
  ) {
    const {
      vertexProjectId,
      vertexLocation,
      vertexEngineId,
      vertexServingConfigId,
    } = this.aiConf;

    // https://cloud.google.com/generative-ai-app-builder/docs/locations#specify_a_multi-region_for_your_data_store
    const apiEndpoint =
      vertexLocation === 'global'
        ? 'discoveryengine.googleapis.com'
        : `${vertexLocation}-discoveryengine.googleapis.com`;

    this.client = new SearchServiceClient({
      apiEndpoint,
      ...this.resolveAuth(),
    });

    this.servingConfig =
      this.client.projectLocationCollectionEngineServingConfigPath(
        String(vertexProjectId),
        String(vertexLocation),
        DEFAULT_COLLECTION_ID,
        String(vertexEngineId),
        String(vertexServingConfigId),
      );
  }

  async search(
    query: string,
    pageSize: number = DEFAULT_PAGE_SIZE,
    pageToken?: string,
  ): Promise<VertexSearchResult> {
    try {
      const [results, , response] = await this.client.search(
        {
          servingConfig: this.servingConfig,
          query,
          pageSize,
          pageToken,
        },
        // Warning: Should always disable autoPaginate to avoid iterating
        // through all pages. By default the client returns an iterable that
        // walks every page of results page-by-page until it exhausts them
        // all, which can mean many sequential requests for a single call.
        { autoPaginate: false },
      );
      return {
        results,
        nextPageToken: response.nextPageToken || undefined,
        totalSize: response.totalSize ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Vertex search failed for query "${query}"`, error);
      throw new RequestException(
        'Vertex AI search request failed',
        HttpStatus.BAD_GATEWAY,
        'VERTEX_SEARCH_FAILED',
      );
    }
  }

  // Service-account credentials take priority; VERTEX_API_KEY is the
  // fallback for searchLite against public website data stores.
  private resolveAuth() {
    const { vertexServiceAccount, vertexApiKey } = this.aiConf;

    if (vertexServiceAccount) {
      // `credentials` is flagged deprecated by google-auth-library over the
      // risk of loading an *untrusted* credential config; ours comes from
      // our own env var, not an external source, so that risk doesn't apply.
      // (The suggested `auth:` alternative doesn't type-check here: gax
      // bundles its own nested google-auth-library, whose GoogleAuth class
      // isn't structurally assignable to this package's.)
      const credentials = JSON.parse(
        Buffer.from(vertexServiceAccount, 'base64').toString('utf8'),
      ) as JWTInput;
      return { credentials };
    }

    if (vertexApiKey) {
      return { apiKey: vertexApiKey };
    }

    return {};
  }
}
