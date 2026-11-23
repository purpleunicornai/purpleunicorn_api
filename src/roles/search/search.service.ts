import { HttpStatus, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { parseRoleFilters, ParsedRoleFilters } from './role-filter-parser';
import { scoreBreakdownRows, scoreColumns } from './score-persistence';
import {
  CriterionExpansions,
  parseCriterionExpansions,
} from './criterion-expansions';
import { GoogleSearchItem } from '../../services/search-item';
import { VertexSearchService } from '../../services/vertex/vertex-search.service';
import {
  GeminiCandidateEducationEnrichment,
  GeminiCandidateEnrichment,
  GeminiCandidateExperienceEnrichment,
  GeminiCandidateFields,
  GeminiCandidateMatch,
  GeminiCandidateSourceEnrichment,
  GEMINI_MODEL,
  GEMINI_PLATFORM,
  CandidateResearch,
} from '../../services/gemini/gemini.service';
import {
  addUsage,
  parseResultUsage,
  recordUsage,
  shareOf,
  type GeminiUsage,
} from '../../services/gemini/gemini-usage';
import { PrismaService } from '../../common/database/prisma.service';
import { ReasoningService } from '../../services/reasoning/reasoning.service';
import type { Reasoning } from '../../services/reasoning/reasoning-model';
import {
  bestContactOf,
  type RocketReachPerson,
} from '../../services/rocket-reach/rocket-reach.service';
import {
  candidate,
  candidate_education,
  candidate_experience,
  candidate_source,
  Prisma,
  role_filter_child,
  role_filter_item,
  role_filters,
  role_result,
  roles,
} from '../../generated/prisma/client.js';
import { SourceType } from '../../generated/prisma/enums';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { Observable } from 'rxjs';
import {
  CandidateScoreCategory,
  CandidateScoreResult,
  CandidateScoringService,
  ScoringFacts,
  scoringFactsOf,
} from './candidate-scoring.service';
import {
  legacyQualifications,
  parseResearchFacts,
  parseScoringFacts,
  parseSearchScore,
  rescoreWithResearch,
  researchFactsOf,
  rocketReachFactsOf,
  combineResearchFacts,
  searchScoreOf,
} from './research-rescore';
import { ExistingCandidateSearchService } from './existing-candidate-search.service';
import { GithubSearchService } from '../../services/github/github-search.service';
import { isKnownWrongCountry } from './filter-terms';
import { describeRole } from './describe-role';
import { applyScores, ScoredCandidate } from './candidate-score';
import { normalizeImageUrl } from './candidate-profile';
import { parseSearchPageToken } from './search-page-token';
import {
  isExhausted,
  mergeSearchProgress,
  parseSearchProgress,
  SearchProgress,
  SearchProgressPatch,
  withSearchProgress,
} from './search-progress';

// Both a freshly-extracted match (GeminiCandidateMatch) and an
// already-known candidate's judgment (GeminiKnownCandidateMatch) carry
// these same four fields — upsertRoleResult only ever reads these, so it
// can serve both saveCandidateMatches and findExistingCandidateMatches
// without duplicating the upsert logic.
type MatchNarrative = Pick<
  GeminiCandidateMatch,
  'summary' | 'reasoning' | 'skills_matched' | 'score'
> & {
  page?: number;
  matchedBy?: 'location' | 'remote';
  missing?: string[];
  nonNegotiableUnconfirmed?: string[];
  qualifications_matched?: string[];
};

// A single generateText call asking Gemini to score the whole result set at
// once scales badly (a 200-item synthetic batch took ~2.7 minutes end to
// end) and puts the entire run at risk of one slow/interrupted call losing
// every candidate. Chunking keeps each Gemini call small and lets matches
// be persisted batch-by-batch instead of only after everything finishes.
const CANDIDATE_FORMAT_BATCH_SIZE = 20;

// A paged search scores each Vertex page (up to 20 profiles) in two Gemini
// calls, so the first results land on screen sooner.
const PAGE_SCORE_BATCH_SIZE = 10;

// The stages a paged search reports, in order.
export const SEARCH_PAGE_STAGES = [
  'preparing',
  'searching',
  'scoring',
  'ranking',
] as const;
export type SearchPageStage = (typeof SEARCH_PAGE_STAGES)[number];

export type SearchPageStageEvent = {
  stage: SearchPageStage;
  status: 'started' | 'progress' | 'done';
  page: number;
  // searching:done
  found?: number;
  estimatedTotal?: number | null;
  skippedDuplicates?: number;
  // scoring
  completed?: number;
  total?: number;
  // preparing:done and scoring:progress: results saved since the last event.
  savedIds?: string[];
};

export type SearchPageDone = {
  page: number;
  hasMore: boolean;
  estimatedTotal: number | null;
  saved: number;
  tokensUsed: number;
};

export type SearchPageOutcome =
  | ({ kind: 'done' } & SearchPageDone)
  // shouldStop asked to stop between batches; the resume point is unmoved.
  | { kind: 'stopped' }
  // The role's filters were replaced since the job started.
  | { kind: 'superseded' };

export interface SearchPageHooks {
  onStage?: (event: SearchPageStageEvent) => void | Promise<void>;
  shouldStop?: () => Promise<boolean>;
}

// Contact details from a RocketReach profile, only for fields the stored
// candidate doesn't have yet. Over a value this research run guessed for
// an empty field, RocketReach's looked-up one wins.
function contactFromRocketReach(
  person: RocketReachPerson | undefined,
  existing: candidate,
): Prisma.candidateUpdateInput {
  if (!person) return {};
  const { email, phone } = bestContactOf(person);
  const data: Prisma.candidateUpdateInput = {
    ...(!existing.rocketreach_profile_id
      ? { rocketreach_profile_id: String(person.id) }
      : {}),
    ...(!existing.email && email ? { email } : {}),
    ...(!existing.phone && phone ? { phone } : {}),
  };
  return data.email || data.phone
    ? { ...data, contact_info_last_updated: new Date() }
    : data;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly vertexSearchService: VertexSearchService,
    private readonly reasoningService: ReasoningService,
    private readonly candidateScoringService: CandidateScoringService,
    private readonly existingCandidateSearchService: ExistingCandidateSearchService,
    private readonly githubSearchService: GithubSearchService,
    private readonly prisma: PrismaService,
  ) {}

  async search(
    roleId: string,
    role: roles,
    userId: string,
    userName: string,
  ): Promise<role_result[]> {
    const filterSet = await this.getRoleFilters(roleId);
    const filters = parseRoleFilters(filterSet.role_filter_items);
    const expansions = parseCriterionExpansions(filterSet.metadata);
    const ai = await this.reasoningService.forRole(roleId);

    const roleResults: role_result[] = [];
    roleResults.push(
      ...(await this.findExistingCandidateMatches(
        role.uid,
        filterSet.uid,
        filters,
        ai,
      )),
    );

    const { items, sourceByLink } = await this.searchForItems(
      filters,
      role.name,
      expansions,
    );
    for (const batch of this.chunk(items, CANDIDATE_FORMAT_BATCH_SIZE)) {
      const formatted = await this.formatBatch(batch, filters, ai);
      const saved = await this.saveCandidateMatches(
        role.uid,
        filterSet.uid,
        filters,
        formatted,
        sourceByLink,
      );
      roleResults.push(...saved);
    }

    await this.markSearchRunDate(roleId, userId, userName);
    return roleResults;
  }

  // Digs deeper on a single already-found candidate to build out their
  // profile — a no-op if it's already been done (enriched_at is set) or
  // there's no name on file to search on, unless `force` is set to bypass
  // the already-enriched check and refetch with grounded research regardless. Always
  // includes `experience`/`education` so every return path has the same shape.
  // `rocketReach` is a person lookup already under way (it runs alongside
  // the AI research): its profile fills empty contact fields, adds title,
  // employer and country facts to the re-score, and is kept raw on the
  // result's metadata.
  async deepSearchCandidate(
    candidateUid: string,
    roleId: string,
    force = false,
    {
      rocketReach,
    }: { rocketReach?: Promise<RocketReachPerson | undefined> } = {},
  ): Promise<
    candidate & {
      experience: candidate_experience[];
      education: candidate_education[];
      sources: candidate_source[];
    }
  > {
    const existing = await this.prisma.candidate.findUniqueOrThrow({
      where: { uid: candidateUid },
      include: {
        experience: true,
        education: true,
        sources: true,
        role_results: {
          where: {
            role_id: roleId,
          },
        },
      },
    });
    if (existing.enriched_at && !force) return existing;

    const fullName = [existing.first_name, existing.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!fullName) return existing;

    const filterSet = await this.getRoleFilters(roleId);
    const filters = parseRoleFilters(filterSet.role_filter_items);
    const linkedinUrl =
      existing.sources.find((source) => source.main)?.url ??
      existing.sources.find((source) =>
        (source.url ?? '').includes('linkedin.com/in/'),
      )?.url ??
      '';

    const ai = await this.reasoningService.forRole(roleId);
    const researching = ai.provider.researchCandidate(
      describeRole(filters),
      {
        name: fullName,
        headline: existing.current_title ?? undefined,
        company: existing.current_company ?? undefined,
        location: [
          existing.current_location_city,
          existing.current_location_country_code,
        ]
          .filter(Boolean)
          .join(', '),
        linkedinUrl,
        imageUrl: existing.image_url ?? undefined,
      },
      { model: ai.model },
    );
    const [research, person] = await Promise.all([researching, rocketReach]);
    const enrichment = enrichmentFromResearch(research);

    await this.createCandidateExperience(
      candidateUid,
      this.mergeCurrentRoleExperience(existing, enrichment),
    );
    await this.createCandidateEducation(candidateUid, enrichment.education);
    await this.createAdditionalCandidateSources(
      candidateUid,
      enrichment.additional_sources,
    );

    const updated = await this.prisma.candidate.update({
      where: { uid: candidateUid },
      data: {
        ...this.buildEnrichmentCandidateData(enrichment, existing),
        ...contactFromRocketReach(person, existing),
        enriched_at: new Date(),
      },
      include: {
        experience: true,
        education: true,
        sources: true,
        role_results: {
          where: {
            role_id: roleId,
          },
        },
      },
    });

    const roleResult = existing.role_results?.[0];
    if (roleResult) {
      const previous = asMetadata(roleResult.metadata);
      const usage = parseResultUsage(roleResult.metadata);
      const researchUsage = recordUsage(usage.research, research.usage);

      // Re-run the fixed algorithm on the search-time evidence plus this
      // research's verified facts. The search snapshot (taken from the
      // record before research touched it, on results saved before
      // snapshots were kept) is stored, so a re-run never stacks.
      const searchFacts =
        parseScoringFacts(previous.searchEvidence) ??
        scoringFactsOf(existing, {
          qualifications: legacyQualifications(
            await this.prisma.role_result_score_breakdown.findMany({
              where: { role_result_id: roleResult.uid },
            }),
          ),
        });
      const searchScore = parseSearchScore(previous.searchScore) ?? {
        score: roleResult.score ?? 0,
        rawScore:
          roleResult.pre_disqualification_score ?? roleResult.score ?? 0,
        disqualified: !!roleResult.disqualified,
        disqualifiedReasons: roleResult.disqualified_reasons ?? [],
      };
      const researchFacts = combineResearchFacts(
        researchFactsOf(research),
        rocketReachFactsOf(person),
      );
      const { final, researchBefore } = rescoreWithResearch(
        this.candidateScoringService,
        filters,
        searchFacts,
        researchFacts,
      );

      const { researchEvidence: _staleResearch, ...kept } = previous;
      void _staleResearch;
      const metadata = {
        ...kept,
        ...(researchUsage
          ? { geminiUsage: { ...usage, research: researchUsage } }
          : {}),
        ...(research.findings.length ? { findings: research.findings } : {}),
        identityConfidence: research.identityConfidence,
        identityReason: research.identityReason,
        searchQueries: research.searchQueries,
        searchEvidence: searchFacts,
        searchScore,
        ...(researchFacts ? { researchEvidence: researchFacts } : {}),
        ...(person
          ? {
              rocketReach: {
                fetchedAt: new Date().toISOString(),
                // Parsed from RocketReach's JSON response, so it is JSON.
                profile: person as unknown as Prisma.InputJsonObject,
              },
            }
          : {}),
      };
      await this.prisma.role_result.update({
        where: { uid: roleResult.uid },
        data: {
          summary: research.summary,
          reasoning: research.reasoning,
          ai_score: research.score,
          ...scoreColumns(final),
          sources: mergeSources(
            roleResult.sources,
            research.sources.map((source) => source.url),
          ),
          metadata,
        },
      });
      await this.createScoreBreakdown(
        roleResult.uid,
        filterSet.uid,
        final.breakdown,
        researchBefore,
      );
    }

    return updated;
  }

  // Scalar fields get overwritten by newly-found values (a targeted deep
  // search is treated as more reliable than the original broad match);
  // list fields get unioned with what's already known so a second pass
  // doesn't erase previously-discovered facts.
  private buildEnrichmentCandidateData(
    enrichment: GeminiCandidateEnrichment,
    existing: candidate,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    const scalarFields = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'country_calling_code',
      'current_location_city',
      'current_location_country_code',
      'current_location_postal_code',
      'open_to_relocation',
      'open_to_remote_work',
      'current_work_authorization_status',
      'experience_years',
      'current_title',
      'current_company',
      'current_salary',
      'current_salary_currency',
      'summary',
      'image_url',
    ] as const;
    for (const field of scalarFields) {
      const value = enrichment[field];
      if (value !== undefined) data[field] = value;
    }
    // Never let a placeholder (or junk) replace a real stored photo.
    if ('image_url' in data) {
      const imageUrl = normalizeImageUrl(data.image_url as string);
      if (imageUrl) data.image_url = imageUrl;
      else delete data.image_url;
    }

    if (enrichment.current_role_start_date !== undefined) {
      data.current_role_start_date = new Date(
        enrichment.current_role_start_date,
      );
    }

    const listFields = [
      'experience_roles',
      'skills',
      'languages',
      'diversity',
    ] as const;
    for (const field of listFields) {
      const incoming = enrichment[field];
      if (incoming?.length) {
        data[field] = this.unionStrings(existing[field], incoming);
      }
    }

    return data;
  }

  private unionStrings(existing: string[], incoming: string[]): string[] {
    return [...new Set([...existing, ...incoming])];
  }

  // Synthesizes a candidate_experience row for the candidate's current role
  // from the scalar current_title/current_company/current_role_start_date
  // fields, so a candidate still gets a usable experience entry even when
  // Gemini hasn't (or hasn't yet) returned a detailed history. Skipped when
  // any of the three is missing, since start_date is a required column.
  private buildCurrentRoleExperienceRow(
    company: string | undefined,
    role: string | undefined,
    startDate: Date | string | undefined,
  ):
    | {
        company_name: string;
        role: string;
        start_date: Date;
        end_date: null;
        skills: string[];
      }
    | undefined {
    if (!company || !role || !startDate) return undefined;
    return {
      company_name: company,
      role,
      start_date: startDate instanceof Date ? startDate : new Date(startDate),
      end_date: null,
      skills: [],
    };
  }

  // Appends a synthesized current-role entry to Gemini's experience list when
  // the resolved current_company/current_title/current_role_start_date (from
  // this enrichment, falling back to what was already known) aren't already
  // represented in it — so a candidate still gets a usable experience row
  // even when Gemini didn't return detailed history. Falls back to the
  // existing candidate's fields since a given enrichment pass may only touch
  // a subset of scalar fields.
  private mergeCurrentRoleExperience(
    existing: candidate,
    enrichment: GeminiCandidateEnrichment,
  ): GeminiCandidateExperienceEnrichment[] | undefined {
    const company = enrichment.current_company ?? existing.current_company;
    const role = enrichment.current_title ?? existing.current_title;
    const startDate =
      enrichment.current_role_start_date ??
      existing.current_role_start_date?.toISOString();

    if (!company || !role || !startDate) return enrichment.experience;

    const alreadyCovered = (enrichment.experience ?? []).some(
      (entry) =>
        entry.company_name.trim().toLowerCase() ===
        company.trim().toLowerCase(),
    );
    if (alreadyCovered) return enrichment.experience;

    return [
      ...(enrichment.experience ?? []),
      { company_name: company, role, start_date: startDate },
    ];
  }

  // candidate_experience.start_date is a required column — an entry Gemini
  // couldn't pin a start date on gets skipped rather than written with a
  // fabricated date.
  private async createCandidateExperience(
    candidateUid: string,
    experience?: GeminiCandidateExperienceEnrichment[],
  ): Promise<void> {
    const rows = (experience ?? [])
      .filter((entry) => Boolean(entry.start_date))
      .map((entry) => ({
        candidate_id: candidateUid,
        company_name: entry.company_name,
        company_location: entry.company_location,
        role: entry.role,
        start_date: new Date(entry.start_date as string),
        end_date: entry.end_date ? new Date(entry.end_date) : null,
        responsibilities: entry.responsibilities,
        skills: entry.skills ?? [],
      }));

    if (rows.length === 0) return;

    await this.prisma.candidate_experience.createMany({ data: rows });
  }

  // candidate_education.start_date is a required column — an entry Gemini
  // couldn't pin a start date on gets skipped rather than written with a
  // fabricated date.
  private async createCandidateEducation(
    candidateUid: string,
    education?: GeminiCandidateEducationEnrichment[],
  ): Promise<void> {
    const rows = (education ?? [])
      .filter((entry) => Boolean(entry.start_date))
      .map((entry) => ({
        candidate_id: candidateUid,
        institution_name: entry.institution_name,
        institution_type: entry.institution_type,
        institution_location: entry.institution_location,
        degree: entry.degree,
        field_of_study: entry.field_of_study,
        start_date: new Date(entry.start_date as string),
        end_date: entry.end_date ? new Date(entry.end_date) : null,
        summary: entry.summary,
        additional_info: entry.additional_info,
      }));

    if (rows.length === 0) return;

    await this.prisma.candidate_education.createMany({ data: rows });
  }

  // Newly-found platforms from a deep search become their own
  // candidate_source rows (main: false — the original creation-time source
  // stays the primary one), the same "create sources" operation
  // upsertCandidate performs for a brand-new candidate.
  private async createAdditionalCandidateSources(
    candidateUid: string,
    additionalSources?: GeminiCandidateSourceEnrichment[],
  ): Promise<void> {
    const rows = (additionalSources ?? []).map((entry) => ({
      candidate_id: candidateUid,
      title: entry.title,
      source: entry.name,
      url: entry.url,
      main: false,
      type: SourceType.SEARCH,
    }));

    if (rows.length === 0) return;

    await this.prisma.candidate_source.createMany({ data: rows });
  }

  streamSearch(
    roleId: string,
    userId: string,
    userName: string,
    roleName?: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.logger.debug(`Starting search for roleId=${roleId}`);
      const run = async () => {
        try {
          subscriber.next({
            type: 'stage',
            data: { stage: 'fetching filters', status: 'started' },
          });
          this.logger.debug(`Fetching role filter for roleId=${roleId}`);
          const filterSet = await this.getRoleFilters(roleId);
          subscriber.next({
            type: 'stage',
            data: { stage: 'fetching filters', status: 'done' },
          });
          this.logger.debug('Filter search', JSON.stringify(filterSet));

          subscriber.next({
            type: 'stage',
            data: { stage: 'parsing filters', status: 'started' },
          });
          this.logger.debug('Parsing role filters');
          const filters = parseRoleFilters(filterSet.role_filter_items);
          const expansions = parseCriterionExpansions(filterSet.metadata);
          const ai = await this.reasoningService.forRole(roleId);
          subscriber.next({
            type: 'stage',
            data: { stage: 'parsing filters', status: 'done' },
          });

          this.logger.debug('PARSED FILTERS', JSON.stringify(filters));

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching existing candidates',
              status: 'started',
            },
          });
          const roleResults: role_result[] = [];
          const existingMatches = await this.findExistingCandidateMatches(
            roleId,
            filterSet.uid,
            filters,
            ai,
          );
          roleResults.push(...existingMatches);
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching existing candidates',
              status: 'done',
              result: existingMatches.length,
              results: existingMatches,
            },
          });

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching candidates',
              status: 'started',
            },
          });
          // TODO - Need to add update in here.
          const { items, sourceByLink } = await this.searchForItems(
            filters,
            roleName,
            expansions,
          );
          this.logger.debug(
            `Finished searching candidates for roleId=${roleId}, found ${items?.length} items`,
          );
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching candidates',
              status: 'done',
              result: items?.length,
            },
          });

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'formating candidates',
              status: 'started',
            },
          });
          this.logger.debug(`Formatting candidates for roleId=${roleId}`);
          const batches = this.chunk(items, CANDIDATE_FORMAT_BATCH_SIZE);
          for (let i = 0; i < batches.length; i++) {
            this.logger.debug(
              `Formatting batch ${i + 1}/${batches.length} for roleId=${roleId}`,
            );
            const formatted = await this.formatBatch(batches[i], filters, ai);
            const saved = await this.saveCandidateMatches(
              roleId,
              filterSet.uid,
              filters,
              formatted,
              sourceByLink,
            );
            roleResults.push(...saved);
            subscriber.next({
              type: 'stage',
              data: {
                stage: 'formating candidates',
                status: 'progress',
                completed: i + 1,
                total: batches.length,
                // The frontend can render these as they arrive instead of
                // waiting for the final 'done' event to see any results.
                results: saved,
              },
            });
          }
          this.logger.debug(`Formatted candidates for roleId=${roleId}`);
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'formating candidates',
              status: 'done',
            },
          });

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'saving candidates',
              status: 'started',
            },
          });
          this.logger.debug(`Saving candidates for roleId=${roleId}`);
          await this.markSearchRunDate(roleId, userId, userName);
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'saving candidates',
              status: 'done',
            },
          });
          subscriber.next({
            type: 'done',
            data: {
              result: roleResults,
            },
          });

          this.logger.debug('Completed search stream for roleId=' + roleId);

          subscriber.complete();
        } catch (e) {
          subscriber.next({
            type: 'error',
            data: { message: e instanceof Error ? e.message : String(e) },
          });
          subscriber.complete();
        }
      };
      void run();
    });
  }

  // Runs one page of the role's search: existing candidates on page 1, then
  // one Vertex page (plus GitHub on page 1), scored and saved in small
  // batches, and moves the filter set's resume point on. `shouldStop` is
  // checked between batches; stopping leaves the resume point where it was,
  // so resuming re-runs that page (saved results are upserted). The role
  // background job (RoleSearchProcessor) calls this once per page.
  async runSearchPage(
    roleId: string,
    filterId: string,
    userId: string,
    userName: string,
    roleName: string | undefined,
    { onStage, shouldStop }: SearchPageHooks = {},
  ): Promise<SearchPageOutcome> {
    const emit = async (event: SearchPageStageEvent) => {
      await onStage?.(event);
    };
    const stopRequested = async () => (shouldStop ? shouldStop() : false);

    const filterSet = await this.getRoleFilters(roleId);
    if (filterSet.uid !== filterId) return { kind: 'superseded' };
    const filters = parseRoleFilters(filterSet.role_filter_items);
    const expansions = parseCriterionExpansions(filterSet.metadata);
    const previous = parseSearchProgress(filterSet.metadata);
    if (previous && isExhausted(previous)) {
      return {
        kind: 'done',
        page: previous.pagesLoaded,
        hasMore: false,
        estimatedTotal: previous.estimatedTotal,
        saved: 0,
        tokensUsed: 0,
      };
    }

    const page = (previous?.pagesLoaded ?? 0) + 1;
    await emit({ stage: 'preparing', status: 'started', page });
    const ai = await this.reasoningService.forRole(roleId);
    const saved: role_result[] =
      page === 1
        ? await this.findExistingCandidateMatches(roleId, filterId, filters, ai)
        : [];
    await emit({
      stage: 'preparing',
      status: 'done',
      page,
      savedIds: saved.map((result) => result.uid),
    });
    if (await stopRequested()) return { kind: 'stopped' };

    await emit({ stage: 'searching', status: 'started', page });
    const vertexPage = await this.vertexSearchService.searchRolePage(
      filters,
      roleName,
      expansions,
      previous?.nextPageToken
        ? parseSearchPageToken(previous.nextPageToken)
        : undefined,
    );
    const githubItems =
      page === 1 ? await this.githubSearchService.search(filters) : [];
    const sourceByLink = new Map<string, string>();
    for (const item of vertexPage.items) sourceByLink.set(item.link, 'Vertex');
    for (const item of githubItems) sourceByLink.set(item.link, 'GitHub');
    const items = [...vertexPage.items, ...githubItems];
    const estimatedTotal =
      vertexPage.estimatedTotal ?? previous?.estimatedTotal ?? null;
    await emit({
      stage: 'searching',
      status: 'done',
      page,
      found: items.length,
      estimatedTotal,
      skippedDuplicates: vertexPage.skippedDuplicates,
    });

    await emit({
      stage: 'scoring',
      status: 'started',
      page,
      completed: 0,
      total: items.length,
    });
    let completed = 0;
    for (const batch of this.chunk(items, PAGE_SCORE_BATCH_SIZE)) {
      if (await stopRequested()) return { kind: 'stopped' };
      const formatted = await this.formatBatch(batch, filters, ai);
      const batchSaved = await this.saveCandidateMatches(
        roleId,
        filterId,
        filters,
        formatted,
        sourceByLink,
      );
      saved.push(...batchSaved);
      completed += batch.length;
      await emit({
        stage: 'scoring',
        status: 'progress',
        page,
        completed,
        total: items.length,
        savedIds: batchSaved.map((result) => result.uid),
      });
    }
    if (await stopRequested()) return { kind: 'stopped' };

    await emit({ stage: 'ranking', status: 'started', page });
    const nextPageToken = vertexPage.nextPageToken ?? null;
    await this.saveSearchProgress(filterId, {
      pagesLoaded: page,
      nextPageToken,
      estimatedTotal,
    });
    await this.markSearchRunDate(roleId, userId, userName);
    await emit({ stage: 'ranking', status: 'done', page });

    return {
      kind: 'done',
      page,
      hasMore: nextPageToken !== null,
      estimatedTotal,
      saved: saved.length,
      tokensUsed: saved.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0),
    };
  }

  // The role's current filter set, if it has one, for reading its progress.
  findActiveFilterSet(
    roleId: string,
  ): Promise<Pick<role_filters, 'uid' | 'metadata'> | null> {
    return this.prisma.role_filters.findFirst({
      where: { role_id: roleId, archived: false },
      select: { uid: true, metadata: true },
    });
  }

  // Patches the filter set's search progress, re-reading its metadata first
  // so other keys (criterion expansions) and fields are kept.
  async saveSearchProgress(
    filterId: string,
    patch: SearchProgressPatch,
  ): Promise<SearchProgress> {
    const filterSet = await this.prisma.role_filters.findUnique({
      where: { uid: filterId },
      select: { metadata: true },
    });
    const progress = mergeSearchProgress(
      parseSearchProgress(filterSet?.metadata),
      patch,
    );
    await this.prisma.role_filters.update({
      where: { uid: filterId },
      data: {
        metadata: withSearchProgress(
          filterSet?.metadata,
          progress,
        ) as Prisma.InputJsonObject,
      },
    });
    return progress;
  }

  private async getRoleFilters(roleId: string): Promise<
    role_filters & {
      role_filter_items: (role_filter_item & {
        children: role_filter_child[];
      })[];
    }
  > {
    const filterSet = await this.prisma.role_filters.findFirst({
      where: { role_id: roleId, archived: false },
      include: { role_filter_items: { include: { children: true } } },
    });

    if (!filterSet) {
      throw new RequestException(
        'Role filter not found',
        HttpStatus.NOT_FOUND,
        'ROLE_FILTER_NOT_FOUND',
      );
    }

    return filterSet;
  }

  private async saveCandidateMatches(
    roleId: string,
    filterId: string,
    filters: ParsedRoleFilters,
    result: {
      matches: GeminiCandidateMatch[];
      tokensUsed: number;
      usage?: GeminiUsage | null;
      // The reasoning model that produced the matches.
      model: string;
    },
    sourceByLink: Map<string, string>,
  ): Promise<role_result[]> {
    const tokensPerMatch = result.matches.length
      ? Math.round(result.tokensUsed / result.matches.length)
      : 0;
    const usagePerMatch = result.usage
      ? shareOf(result.usage, result.matches.length)
      : null;

    const roleResults: role_result[] = [];
    for (const match of result.matches) {
      // Vertex still returns some people outside a required country (a
      // profile can mention "South Africa" without being based there), so
      // drop anyone whose stated country is known to be wrong.
      if (
        isKnownWrongCountry(
          filters,
          match.candidate.current_location_country_code,
          match.candidate.open_to_relocation,
        )
      ) {
        this.logger.debug(
          `Skipping ${match.candidate.source_url ?? 'result'}: based in ${match.candidate.current_location_country_code}`,
        );
        continue;
      }
      const candidateRecord = await this.upsertCandidate(match.candidate);
      const evidence = { qualifications: match.qualifications_matched };
      const scoreResult = this.candidateScoringService.scoreCandidate(
        filters,
        candidateRecord,
        evidence,
      );
      // Gemini is instructed to copy source_url verbatim from the input
      // item's link, so it doubles as the key for recovering which engine
      // actually produced this match — default to Vertex since that's the
      // dominant source if a URL was altered or omitted.
      const source = match.candidate.source_url
        ? (sourceByLink.get(match.candidate.source_url) ?? 'Vertex')
        : 'Vertex';
      const roleResult = await this.upsertRoleResult(
        roleId,
        filterId,
        candidateRecord.uid,
        match,
        tokensPerMatch,
        scoreResult,
        source,
        usagePerMatch,
        { filters, facts: scoringFactsOf(candidateRecord, evidence) },
        result.model,
      );
      roleResults.push(roleResult);
    }

    return roleResults;
  }

  // Vertex (LinkedIn profiles) and GitHub are two independent candidate sources that both
  // return the same GoogleSearchItem shape — merging them here means every
  // downstream step (chunking, Gemini extraction, upsertCandidate dedup by
  // source_url) needs no awareness that more than one source exists. The
  // link->engine map is built before merging (while the two lists are still
  // separate) so that once Gemini returns a match's source_url, we can
  // still tell which engine actually found it, to record on role_result.
  private async searchForItems(
    filters: ParsedRoleFilters,
    roleName: string | undefined,
    expansions: CriterionExpansions | null,
  ): Promise<{
    items: GoogleSearchItem[];
    sourceByLink: Map<string, string>;
  }> {
    const vertexItems = await this.vertexSearchService.search(
      filters,
      roleName,
      expansions,
    );
    const githubItems = await this.githubSearchService.search(filters);

    const sourceByLink = new Map<string, string>();
    for (const item of vertexItems) sourceByLink.set(item.link, 'Vertex');
    for (const item of githubItems) sourceByLink.set(item.link, 'GitHub');

    return { items: [...vertexItems, ...githubItems], sourceByLink };
  }

  // Finds candidates already on file that weren't surfaced by this role's
  // Vertex search, scores them with the same deterministic algorithm used
  // for freshly-found matches, and sends only the top-ranked, non-
  // disqualified subset to Gemini for a narrative judgment — capping
  // Gemini usage regardless of how many candidates the DB query returns.
  private async findExistingCandidateMatches(
    roleId: string,
    filterId: string,
    filters: ParsedRoleFilters,
    ai: Reasoning,
  ): Promise<role_result[]> {
    const pool = await this.existingCandidateSearchService.findCandidates(
      roleId,
      filters,
    );

    const ranked = pool
      .map((candidate) => ({
        candidate,
        scoreResult: this.candidateScoringService.scoreCandidate(
          filters,
          candidate,
        ),
      }))
      .filter(
        ({ scoreResult }) => !scoreResult.disqualified && scoreResult.score > 0,
      )
      .sort((a, b) => b.scoreResult.score - a.scoreResult.score)
      .slice(0, CANDIDATE_FORMAT_BATCH_SIZE);

    if (ranked.length === 0) return [];

    const { matches, tokensUsed, usage } =
      await ai.provider.scoreKnownCandidates(
        ranked.map((entry) => entry.candidate),
        filters,
        { model: ai.model },
      );
    const tokensPerMatch = matches.length
      ? Math.round(tokensUsed / matches.length)
      : 0;
    const usagePerMatch = usage ? shareOf(usage, matches.length) : null;

    const roleResults: role_result[] = [];
    for (const entry of ranked) {
      const match = matches.find(
        (candidateMatch) =>
          candidateMatch.candidate_uid === entry.candidate.uid,
      );
      if (!match) continue;

      const roleResult = await this.upsertRoleResult(
        roleId,
        filterId,
        entry.candidate.uid,
        match,
        tokensPerMatch,
        entry.scoreResult,
        'Database',
        usagePerMatch,
        { filters, facts: scoringFactsOf(entry.candidate) },
        ai.model,
      );
      roleResults.push(roleResult);
    }

    return roleResults;
  }

  // Targets the role's CURRENT non-archived filter set by role_id rather
  // than the uid captured at the start of the search — a search can run
  // for minutes, and if the role's filters get replaced mid-run (archiving
  // the row this search started against), the stamp must land on whatever
  // is active now, not on the now-archived row this search actually ran
  // against.
  private async markSearchRunDate(
    roleId: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    await this.prisma.role_filters.updateMany({
      where: { role_id: roleId, archived: false },
      data: {
        search_run_date: new Date(),
        search_run_by: userName,
        search_run_by_id: userId,
      },
    });
  }

  // A single Gemini timeout or malformed response used to abort the whole
  // search and lose every later batch. Skip just that batch instead.
  private async formatBatch(
    batch: GoogleSearchItem[],
    filters: ParsedRoleFilters,
    ai: Reasoning,
  ): Promise<{
    matches: Array<GeminiCandidateMatch & MatchNarrative>;
    tokensUsed: number;
    usage: GeminiUsage | null;
    model: string;
  }> {
    const extractedItems = batch.filter((item) => item.extracted);
    const otherItems = batch.filter((item) => !item.extracted);
    const matches: Array<GeminiCandidateMatch & MatchNarrative> = [];
    let tokensUsed = 0;
    let usage: GeminiUsage | null = null;

    if (extractedItems.length > 0) {
      const profiles = extractedItems.map((item) => item.extracted!);
      try {
        const scored = await ai.provider.scoreCandidates(
          describeRole(filters),
          profiles,
          { model: ai.model },
        );
        tokensUsed += scored.tokensUsed;
        usage = addUsage(usage, scored.usage);
        const ranked = applyScores(profiles, scored.scores);
        matches.push(
          ...ranked.map((candidate) =>
            scoredCandidateToMatch(candidate, extractedItems),
          ),
        );
      } catch (error) {
        this.logger.warn(
          `Scoring failed for ${extractedItems.length} LinkedIn result(s): ${error instanceof Error ? error.message : String(error)}. Saving extracted profiles unscored.`,
        );
        matches.push(
          ...extractedItems.map((item) =>
            scoredCandidateToMatch(item.extracted!, extractedItems),
          ),
        );
      }
    }

    if (otherItems.length > 0) {
      try {
        const formatted = await ai.provider.formatCandidates(
          otherItems,
          filters,
          { model: ai.model },
        );
        if (formatted.matches.length < otherItems.length) {
          this.logger.debug(
            `Gemini returned ${formatted.matches.length} of ${otherItems.length} result(s) in a batch`,
          );
        }
        tokensUsed += formatted.tokensUsed;
        usage = addUsage(usage, formatted.usage);
        matches.push(...formatted.matches);
      } catch (error) {
        this.logger.warn(
          `Skipping a batch of ${otherItems.length} result(s): Gemini failed with ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { matches, tokensUsed, usage, model: ai.model };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private async upsertCandidate(fields: GeminiCandidateFields): Promise<
    candidate & {
      experience: candidate_experience[];
      education: candidate_education[];
    }
  > {
    const { source_title, source_name, source_url, ...scalarFields } = fields;
    const data = this.buildCandidateData(scalarFields);

    // A matching source_url is the strongest signal, but the same person
    // is often found again at a different URL entirely (their LinkedIn vs.
    // their GitHub) — an exact first+last name match is treated as "almost
    // certainly the same person" too, even though that carries some risk
    // of merging two different people who happen to share a full name.
    const matchConditions: Prisma.candidateWhereInput[] = [];
    if (source_url) {
      matchConditions.push({ sources: { some: { url: source_url } } });
    }
    if (scalarFields.first_name && scalarFields.last_name) {
      matchConditions.push({
        first_name: { equals: scalarFields.first_name, mode: 'insensitive' },
        last_name: { equals: scalarFields.last_name, mode: 'insensitive' },
      });
    }

    const existing =
      matchConditions.length > 0
        ? await this.prisma.candidate.findFirst({
            where: { OR: matchConditions },
            include: { experience: true, education: true },
          })
        : null;

    if (!existing) {
      const currentRoleRow = this.buildCurrentRoleExperienceRow(
        data.current_company as string | undefined,
        data.current_title as string | undefined,
        data.current_role_start_date as Date | undefined,
      );

      return this.prisma.candidate.create({
        data: {
          ...(data as Prisma.candidateCreateInput),
          sources: {
            create: [
              {
                title: source_title,
                source: source_name,
                url: source_url,
                main: true,
                type: SourceType.SEARCH,
              },
            ],
          },
          ...(currentRoleRow && { experience: { create: [currentRoleRow] } }),
        },
        include: { experience: true, education: true },
      });
    }

    const existingRecord = existing as unknown as Record<string, unknown>;
    const changed = Object.entries(data).some(
      ([key, value]) => !this.valuesEqual(existingRecord[key], value),
    );
    if (!changed) return existing;

    return this.prisma.candidate.update({
      where: { uid: existing.uid },
      data: data,
      include: { experience: true, education: true },
    });
  }

  private async upsertRoleResult(
    roleId: string,
    filterId: string,
    candidateUid: string,
    match: MatchNarrative,
    tokensUsed: number,
    scoreResult: CandidateScoreResult,
    source: string,
    // This result's share of the scoring call(s); null when not reported.
    usageShare: GeminiUsage | null = null,
    // What scoreResult was scored from. Kept as the search snapshot, and
    // used to re-apply earlier deep research on top of this search.
    search?: { filters: ParsedRoleFilters; facts: ScoringFacts },
    aiModel: string = GEMINI_MODEL,
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidateUid },
    });

    const previous = asMetadata(existing?.metadata);
    const usage = parseResultUsage(existing?.metadata);
    const scoring = recordUsage(usage.scoring, usageShare);
    const geminiUsage = { ...usage, ...(scoring ? { scoring } : {}) };
    // A researched result keeps its research: the new search evidence plus
    // the latest research's facts, scored by the same fixed algorithm.
    const { final, researchBefore } = search
      ? rescoreWithResearch(
          this.candidateScoringService,
          search.filters,
          search.facts,
          parseResearchFacts(previous.researchEvidence),
          scoreResult,
        )
      : { final: scoreResult, researchBefore: [] };
    const metadata = {
      // Deep research's findings outlive a re-score.
      ...Object.fromEntries(
        RESEARCH_METADATA_KEYS.filter((key) => key in previous).map((key) => [
          key,
          previous[key],
        ]),
      ),
      ...(Object.keys(geminiUsage).length > 0 ? { geminiUsage } : {}),
      ...(match.matchedBy ? { matchedBy: match.matchedBy } : {}),
      ...(match.missing ? { missing: match.missing } : {}),
      ...(match.nonNegotiableUnconfirmed
        ? { nonNegotiableUnconfirmed: match.nonNegotiableUnconfirmed }
        : {}),
      ...(search
        ? {
            searchEvidence: search.facts,
            searchScore: searchScoreOf(scoreResult),
          }
        : {}),
    };
    const data = {
      role_id: roleId,
      filter_id: filterId,
      candidate_uid: candidateUid,
      summary: match.summary,
      reasoning: match.reasoning,
      skills_matched: match.skills_matched,
      ai_score: match.score,
      ...scoreColumns(final),
      tokens_used: tokensUsed,
      sources: [source],
      ai_platform: GEMINI_PLATFORM,
      ai_model: aiModel,
      ...(match.page != null ? { page: match.page } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    const roleResult = existing
      ? await this.prisma.role_result.update({
          where: { uid: existing.uid },
          data,
          include: { candidate: true },
        })
      : await this.prisma.role_result.create({ data });

    await this.createScoreBreakdown(
      roleResult.uid,
      filterId,
      final.breakdown,
      researchBefore,
    );

    return roleResult;
  }

  private async createScoreBreakdown(
    roleResultId: string,
    filterId: string,
    breakdown: CandidateScoreCategory[],
    researchBefore: (number | null)[] = [],
  ): Promise<void> {
    await this.prisma.role_result_score_breakdown.deleteMany({
      where: { role_result_id: roleResultId },
    });
    if (breakdown.length === 0) return;
    await this.prisma.role_result_score_breakdown.createMany({
      data: scoreBreakdownRows(
        roleResultId,
        filterId,
        breakdown,
        researchBefore,
      ),
    });
  }

  // Prisma's generated candidateCreateInput/candidateUncheckedUpdateInput
  // types are too strict for a dynamically-built object (they require
  // first_name to be a literal known key, not inferred from a loop), so
  // this returns a plain Record and the two .create()/.update() call sites
  // below cast it — every key/value pair is copied straight from the
  // scalar subset of GeminiCandidateFields (source_title/source_name/
  // source_url are handled separately as a nested candidate_source create).
  private buildCandidateData(
    fields: Omit<
      GeminiCandidateFields,
      'source_title' | 'source_name' | 'source_url'
    >,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (key === 'image_url') {
        // A placeholder is dropped, so an existing real photo is kept.
        const imageUrl = normalizeImageUrl(value as string);
        if (imageUrl) data[key] = imageUrl;
      } else if (key === 'current_role_start_date') {
        data[key] = new Date(value as string);
      } else {
        data[key] = value;
      }
    }
    return data;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a instanceof Date || b instanceof Date) {
      return this.toDate(a).getTime() === this.toDate(b).getTime();
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((value, index) => this.valuesEqual(value, b[index]))
      );
    }
    return a === b;
  }

  private toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }
    return new Date(NaN);
  }
}

function scoredCandidateToMatch(
  candidate: ScoredCandidate,
  items: GoogleSearchItem[],
): GeminiCandidateMatch & MatchNarrative {
  const item = items.find((entry) => entry.extracted?.key === candidate.key);
  const record = candidate.candidate;
  const main = record.sources?.find((source) => source.main);
  const {
    sources: _sources,
    experience: _experience,
    education: _education,
    ...scalar
  } = record;
  void _sources;
  void _experience;
  void _education;
  return {
    candidate: {
      ...scalar,
      source_title: main?.title ?? candidate.name,
      source_name: main?.source ?? 'LinkedIn',
      source_url: candidate.linkedinUrl,
    },
    summary: candidate.summary ?? '',
    reasoning: candidate.reasoning ?? '',
    skills_matched: candidate.skills_matched ?? [],
    score: candidate.score ?? 0,
    page: item?.page,
    matchedBy: candidate.matchedBy ?? item?.matchedBy,
    missing: candidate.missing,
    nonNegotiableUnconfirmed: candidate.nonNegotiableUnconfirmed,
  };
}

function enrichmentFromResearch(
  research: CandidateResearch,
): GeminiCandidateEnrichment {
  const record = research.candidate;
  return {
    first_name: record.first_name,
    last_name: record.last_name,
    email: record.email,
    phone: record.phone,
    country_calling_code: record.country_calling_code,
    current_location_city: record.current_location_city,
    current_location_country_code: record.current_location_country_code,
    current_location_postal_code: record.current_location_postal_code,
    open_to_relocation: record.open_to_relocation,
    open_to_remote_work: record.open_to_remote_work,
    current_work_authorization_status: record.current_work_authorization_status,
    experience_years: record.experience_years,
    experience_roles: record.experience_roles,
    current_title: record.current_title,
    current_company: record.current_company,
    current_salary: record.current_salary,
    current_salary_currency: record.current_salary_currency,
    current_role_start_date: record.current_role_start_date,
    skills: record.skills,
    languages: record.languages,
    diversity: record.diversity,
    summary: record.summary,
    image_url: record.image_url,
    additional_sources: [
      ...(record.sources ?? [])
        .filter((source) => !source.main)
        .map((source) => ({
          title: source.title,
          name: source.source ?? source.title,
          url: source.url,
        })),
      ...research.sources
        .filter((source) => !isLinkedInUrl(source.url))
        .map((source) => ({
          title: source.title ?? source.url,
          name: source.title ?? 'Web',
          url: source.url,
        })),
    ],
    experience: record.experience,
    education: record.education,
  };
}

function isLinkedInUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

// Written by deepSearchCandidate; kept when a search re-scores the result.
const RESEARCH_METADATA_KEYS = [
  'findings',
  'identityConfidence',
  'identityReason',
  'searchQueries',
  'researchEvidence',
] as const;

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function mergeSources(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const source of incoming) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    merged.push(source);
  }
  return merged;
}
