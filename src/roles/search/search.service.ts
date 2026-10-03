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
} from '../../services/gemini/gemini.service';
import { PrismaService } from '../../common/database/prisma.service';
import {
  candidate,
  candidate_education,
  candidate_experience,
  candidate_source,
  Prisma,
  role_filter_child,
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

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly googleSearchService: GoogleSearchService,
    private readonly geminiService: GeminiService,
    private readonly pageFetchService: PageFetchService,
    private readonly candidateScoringService: CandidateScoringService,
    private readonly prisma: PrismaService,
  ) {}

  async search(roleId: string, role: roles): Promise<role_result[]> {
    const filterRows = await this.getRoleFilters(roleId);
    const filters = parseRoleFilters(filterRows);
    const items = await this.googleSearchService.search(filters);
    const formatted = await this.geminiService.formatCandidates(items, filters);
    return this.saveCandidateMatches(role.uid, filters, formatted);
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

  streamSearch(roleId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      this.logger.debug(`Starting search for roleId=${roleId}`);
      const run = async () => {
        try {
          subscriber.next({
            type: 'stage',
            data: { stage: 'fetching filters', status: 'started' },
          });
          this.logger.debug(`Fetching role filter for roleId=${roleId}`);
          const filterRows = await this.getRoleFilters(roleId);
          subscriber.next({
            type: 'stage',
            data: { stage: 'fetching filters', status: 'done' },
          });

          subscriber.next({
            type: 'stage',
            data: { stage: 'parsing filters', status: 'started' },
          });
          this.logger.debug('Parsing role filters');
          const filters = parseRoleFilters(filterRows);
          subscriber.next({
            type: 'stage',
            data: { stage: 'parsing filters', status: 'done' },
          });

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching candidates',
              status: 'started',
            },
          });
          const items = await this.googleSearchService.search(filters);
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
          const formatted = await this.geminiService.formatCandidates(
            items,
            filters,
          );
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
          const saved = await this.saveCandidateMatches(
            roleId,
            filters,
            formatted,
          );
          subscriber.next({
            type: 'done',
            data: {
              result: saved,
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

  private async getRoleFilters(
    roleId: string,
  ): Promise<(role_filters & { children: role_filter_child[] })[]> {
    const rows = await this.prisma.role_filters.findMany({
      where: { role_id: roleId, archived: false },
      include: { children: true },
    });

    if (rows.length === 0) {
      throw new RequestException(
        'Role filter not found',
        HttpStatus.NOT_FOUND,
        'ROLE_FILTER_NOT_FOUND',
      );
    }

    return rows;
  }

  private async saveCandidateMatches(
    roleId: string,
    filters: ParsedRoleFilters,
    result: { matches: GeminiCandidateMatch[]; tokensUsed: number },
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
      const roleResult = await this.upsertRoleResult(
        roleId,
        candidateRecord.uid,
        match,
        tokensPerMatch,
        scoreResult,
      );
      roleResults.push(roleResult);
    }

    // Stamping search_run_date updates every filter row for this role_id —
    // role_id isn't a unique key (a role now has many filter rows), so this
    // uses updateMany rather than update.
    await this.prisma.role_filters.updateMany({
      where: { role_id: roleId },
      data: { search_run_date: new Date() },
    });

    return roleResults;
  }

  private async upsertCandidate(fields: GeminiCandidateFields): Promise<
    candidate & {
      experience: candidate_experience[];
      education: candidate_education[];
    }
  > {
    const { source_title, source_name, source_url, ...scalarFields } = fields;
    const data = this.buildCandidateData(scalarFields);
    const existing = source_url
      ? await this.prisma.candidate.findFirst({
          where: { sources: { some: { url: source_url } } },
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
    candidateUid: string,
    match: GeminiCandidateMatch,
    tokensUsed: number,
    scoreResult: CandidateScoreResult,
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidateUid },
    });

    const data = {
      role_id: roleId,
      filter_id: null,
      candidate_uid: candidateUid,
      summary: match.summary,
      reasoning: match.reasoning,
      skills_matched: match.skills_matched,
      ai_score: match.score,
      score: scoreResult.disqualified ? 0 : scoreResult.score,
      disqualified: scoreResult.disqualified,
      tokens_used: tokensUsed,
    };

    const roleResult = existing
      ? await this.prisma.role_result.update({
          where: { uid: existing.uid },
          data,
          include: { candidate: true },
        })
      : await this.prisma.role_result.create({ data });

    await this.createScoreBreakdown(roleResult.uid, scoreResult.breakdown);

    return roleResult;
  }

  // A role_result's score breakdown is fully replaced on every save rather
  // than diffed, since the category set and weights are re-derived from
  // scratch each search run.
  private async createScoreBreakdown(
    roleResultId: string,
    breakdown: CandidateScoreCategory[],
  ): Promise<void> {
    await this.prisma.role_result_score_breakdown.deleteMany({
      where: { role_result_id: roleResultId },
    });

    if (breakdown.length === 0) return;

    await this.prisma.role_result_score_breakdown.createMany({
      data: breakdown.map((entry) => ({
        role_result_id: roleResultId,
        role_filter_id: entry.filterId,
        category: entry.category,
        weight: entry.weight,
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
