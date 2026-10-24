import { HttpStatus, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { parseRoleFilters, ParsedRoleFilters } from './role-filter-parser';
import {
  GoogleSearchItem,
  GoogleSearchService,
} from '../../services/google-search/google-search.service';
import { PageFetchService } from '../../services/page-fetch/page-fetch.service';
import {
  GeminiCandidateEducationEnrichment,
  GeminiCandidateEnrichment,
  GeminiCandidateExperienceEnrichment,
  GeminiCandidateFields,
  GeminiCandidateMatch,
  GeminiCandidateSourceEnrichment,
  GeminiService,
  GEMINI_MODEL,
  GEMINI_PLATFORM,
} from '../../services/gemini/gemini.service';
import { PrismaService } from '../../common/database/prisma.service';
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
} from './candidate-scoring.service';
import { ExistingCandidateSearchService } from './existing-candidate-search.service';
import { GithubSearchService } from '../../services/github/github-search.service';

// Both a freshly-extracted match (GeminiCandidateMatch) and an
// already-known candidate's judgment (GeminiKnownCandidateMatch) carry
// these same four fields — upsertRoleResult only ever reads these, so it
// can serve both saveCandidateMatches and findExistingCandidateMatches
// without duplicating the upsert logic.
type MatchNarrative = Pick<
  GeminiCandidateMatch,
  'summary' | 'reasoning' | 'skills_matched' | 'score'
>;

// A single generateText call asking Gemini to score the whole result set at
// once scales badly (a 200-item synthetic batch took ~2.7 minutes end to
// end) and puts the entire run at risk of one slow/interrupted call losing
// every candidate. Chunking keeps each Gemini call small and lets matches
// be persisted batch-by-batch instead of only after everything finishes.
const CANDIDATE_FORMAT_BATCH_SIZE = 20;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly googleSearchService: GoogleSearchService,
    private readonly geminiService: GeminiService,
    private readonly pageFetchService: PageFetchService,
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

    const roleResults: role_result[] = [];
    roleResults.push(
      ...(await this.findExistingCandidateMatches(
        role.uid,
        filterSet.uid,
        filters,
      )),
    );

    const { items, sourceByLink } = await this.searchForItems(
      filters,
      role.name,
    );
    for (const batch of this.chunk(items, CANDIDATE_FORMAT_BATCH_SIZE)) {
      const formatted = await this.geminiService.formatCandidates(
        batch,
        filters,
      );
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
  // the already-enriched check and refetch from Google regardless. Always
  // includes `experience`/`education` so every return path has the same shape.
  async deepSearchCandidate(
    candidateUid: string,
    roleId: string,
    force = false,
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

    const items = await this.googleSearchService.searchCandidate(existing);
    if (items.length === 0) {
      return this.prisma.candidate.update({
        where: { uid: candidateUid },
        data: { enriched_at: new Date() },
        include: { experience: true, education: true, sources: true },
      });
    }

    const enrichedItems = await this.attachPageContent(items);
    const { enrichment } = await this.geminiService.enrichCandidate(
      enrichedItems,
      existing,
    );

    // Create any new work/education/source rows before the final read so
    // they're included in the `experience`/`education`/`sources` this
    // method returns.
    await this.createCandidateExperience(
      candidateUid,
      this.mergeCurrentRoleExperience(existing, enrichment),
    );
    await this.createCandidateEducation(candidateUid, enrichment.education);
    await this.createAdditionalCandidateSources(
      candidateUid,
      enrichment.additional_sources,
    );

    return this.prisma.candidate.update({
      where: { uid: candidateUid },
      data: {
        ...this.buildEnrichmentCandidateData(enrichment, existing),
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
  }

  // Fetches each result's own page text in parallel (PageFetchService skips
  // blocked hosts like LinkedIn and swallows failures on its own, resolving
  // to undefined) so Gemini can prefer the full profile over the search
  // snippet when it's available.
  private async attachPageContent(
    items: GoogleSearchItem[],
  ): Promise<GoogleSearchItem[]> {
    const pageContents = await Promise.all(
      items.map((item) => this.pageFetchService.fetchPageText(item.link)),
    );
    return items.map((item, index) => ({
      ...item,
      page_content: pageContents[index],
    }));
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
          const { items, sourceByLink } = await this.searchForItems(
            filters,
            roleName,
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
            const formatted = await this.geminiService.formatCandidates(
              batches[i],
              filters,
            );
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
    result: { matches: GeminiCandidateMatch[]; tokensUsed: number },
    sourceByLink: Map<string, string>,
  ): Promise<role_result[]> {
    const tokensPerMatch = result.matches.length
      ? Math.round(result.tokensUsed / result.matches.length)
      : 0;

    const roleResults: role_result[] = [];
    for (const match of result.matches) {
      const candidateRecord = await this.upsertCandidate(match.candidate);
      const scoreResult = this.candidateScoringService.scoreCandidate(
        filters,
        candidateRecord,
      );
      // Gemini is instructed to copy source_url verbatim from the input
      // item's link, so it doubles as the key for recovering which engine
      // actually produced this match — default to Google since that's the
      // dominant source if a URL was altered or omitted.
      const source = match.candidate.source_url
        ? (sourceByLink.get(match.candidate.source_url) ?? 'Google')
        : 'Google';
      const roleResult = await this.upsertRoleResult(
        roleId,
        filterId,
        candidateRecord.uid,
        match,
        tokensPerMatch,
        scoreResult,
        source,
      );
      roleResults.push(roleResult);
    }

    return roleResults;
  }

  // Google x-ray and GitHub are two independent candidate sources that both
  // return the same GoogleSearchItem shape — merging them here means every
  // downstream step (chunking, Gemini extraction, upsertCandidate dedup by
  // source_url) needs no awareness that more than one source exists. The
  // link->engine map is built before merging (while the two lists are still
  // separate) so that once Gemini returns a match's source_url, we can
  // still tell which engine actually found it, to record on role_result.
  private async searchForItems(
    filters: ParsedRoleFilters,
    roleName?: string,
  ): Promise<{
    items: GoogleSearchItem[];
    sourceByLink: Map<string, string>;
  }> {
    const googleItems = await this.googleSearchService.search(
      filters,
      roleName,
    );
    const githubItems = await this.githubSearchService.search(filters);

    const sourceByLink = new Map<string, string>();
    for (const item of googleItems) sourceByLink.set(item.link, 'Google');
    for (const item of githubItems) sourceByLink.set(item.link, 'GitHub');

    return { items: [...googleItems, ...githubItems], sourceByLink };
  }

  // Finds candidates already on file that weren't surfaced by this role's
  // Google search, scores them with the same deterministic algorithm used
  // for freshly-found matches, and sends only the top-ranked, non-
  // disqualified subset to Gemini for a narrative judgment — capping
  // Gemini usage regardless of how many candidates the DB query returns.
  private async findExistingCandidateMatches(
    roleId: string,
    filterId: string,
    filters: ParsedRoleFilters,
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

    const { matches, tokensUsed } =
      await this.geminiService.scoreKnownCandidates(
        ranked.map((entry) => entry.candidate),
        filters,
      );
    const tokensPerMatch = matches.length
      ? Math.round(tokensUsed / matches.length)
      : 0;

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
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidateUid },
    });

    const data = {
      role_id: roleId,
      filter_id: filterId,
      candidate_uid: candidateUid,
      summary: match.summary,
      reasoning: match.reasoning,
      skills_matched: match.skills_matched,
      ai_score: match.score,
      score: scoreResult.disqualified ? 0 : scoreResult.score,
      disqualified: scoreResult.disqualified,
      tokens_used: tokensUsed,
      sources: [source],
      ai_platform: GEMINI_PLATFORM,
      ai_model: GEMINI_MODEL,
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
      scoreResult.breakdown,
    );

    return roleResult;
  }

  // A role_result's score breakdown is fully replaced on every save rather
  // than diffed, since the category set and weights are re-derived from
  // scratch each search run. Every breakdown row shares the same
  // role_filter_id: a role now has exactly one active filter set, so there's
  // nothing finer-grained to link back to than that one row.
  private async createScoreBreakdown(
    roleResultId: string,
    filterId: string,
    breakdown: CandidateScoreCategory[],
  ): Promise<void> {
    await this.prisma.role_result_score_breakdown.deleteMany({
      where: { role_result_id: roleResultId },
    });

    if (breakdown.length === 0) return;

    await this.prisma.role_result_score_breakdown.createMany({
      data: breakdown.map((entry) => ({
        role_result_id: roleResultId,
        role_filter_id: filterId,
        category: entry.category,
        // weight is an Int column, but CandidateScoringService divides the
        // 80/20 buckets evenly across however many rows exist (e.g.
        // 80/3 = 26.666...) — rounding it the same way score is rounded
        // keeps the two consistent, so a full match (fraction === 1) can
        // never show a score higher than its own weight.
        weight: Math.round(entry.weight),
        applicable: entry.applicable,
        score: Math.round(entry.earned),
      })),
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
      if (key === 'current_role_start_date') {
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
