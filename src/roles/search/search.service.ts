import { HttpStatus, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { RoleFilterDto, RoleFilterMetadataDto } from '../dto/role_filter.dto';
import { GoogleSearchService } from '../../services/google-search/google-search.service';
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
  filter_location_cities,
  Prisma,
  role_filters,
  role_result,
  roles,
} from '../../generated/prisma/client.js';
import { SourceType } from '../../generated/prisma/enums';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { Observable } from 'rxjs';
import {
  CandidateScoreResult,
  CandidateScoringService,
} from './candidate-scoring.service';

type StoredFilter = role_filters & {
  filter_location_cities: filter_location_cities[];
};

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly googleSearchService: GoogleSearchService,
    private readonly geminiService: GeminiService,
    private readonly candidateScoringService: CandidateScoringService,
    private readonly prisma: PrismaService,
  ) {}

  async search(filterId: string, role: roles): Promise<role_result[]> {
    const filter = await this.getRoleFilter(filterId);
    const dto = this.toRoleFilterDto(filter);
    const items = await this.googleSearchService.search(dto);
    const formatted = await this.geminiService.formatCandidates(items, dto);
    return this.saveCandidateMatches(role.uid, filter.uid, dto, formatted);
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

    const { enrichment } = await this.geminiService.enrichCandidate(
      items,
      existing,
    );

    // Create any new work/education/source rows before the final read so
    // they're included in the `experience`/`education`/`sources` this
    // method returns.
    await this.createCandidateExperience(candidateUid, enrichment.experience);
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
        comapany_name: entry.company_name,
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
          const filter = await this.getRoleFilter(roleId);
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'fetching filters',
              status: 'done',
            },
          });

          subscriber.next({
            type: 'stage',
            data: { stage: 'parsing filters', status: 'started' },
          });
          this.logger.debug('Parsing role filter into DTO');
          const dto = this.toRoleFilterDto(filter);
          subscriber.next({
            type: 'stage',
            data: {
              stage: 'parsing filters',
              status: 'done',
            },
          });

          subscriber.next({
            type: 'stage',
            data: {
              stage: 'searching candidates',
              status: 'started',
            },
          });
          const items = await this.googleSearchService.search(dto);
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
            dto,
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
            filter.role_id,
            filter.uid,
            dto,
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

  private async getRoleFilter(roleId: string): Promise<StoredFilter> {
    const filter = await this.prisma.role_filters.findFirst({
      where: { role_id: roleId, archived: false },
      include: { filter_location_cities: true },
    });

    if (!filter) {
      throw new RequestException(
        'Role filter not found',
        HttpStatus.NOT_FOUND,
        'ROLE_FILTER_NOT_FOUND',
      );
    }

    return filter;
  }

  // Adapts a saved role_filters row (+ its filter_location_cities) back into
  // the RoleFilterDto shape GoogleSearchService/GeminiService already work
  // with, so those services don't need to know about the Prisma entity.
  private toRoleFilterDto(filter: StoredFilter): RoleFilterDto {
    return {
      country_code: filter.country_code ?? '',
      remote_work: filter.remote_work ?? false,
      work_authorization_required: filter.work_authorization_required ?? false,
      experience_min_yrs: filter.experience_min_yrs ?? 0,
      experience_max_yrs: filter.experience_max_yrs ?? 0,
      title: filter.title,
      alternative_titles: filter.alternative_titles,
      title_levels: filter.title_levels,
      roles: filter.roles,
      current_role_min_yrs: filter.current_role_min_yrs,
      current_role_max_yrs: filter.current_role_max_yrs,
      current_role_tenure_yrs: filter.current_role_tenure_yrs,
      required_skills: filter.required_skills,
      optional_skills: filter.optional_skills,
      education_levels: filter.education_levels,
      education_institution: filter.education_institution,
      education_excluded_institutions: filter.education_excluded_institutions,
      education_graduation_min_yr: this.dateToYear(
        filter.education_graduation_min_yr,
      ),
      education_graduation_max_yr: this.dateToYear(
        filter.education_graduation_max_yr,
      ),
      required_languages: filter.required_languages,
      optional_languages: filter.optional_languages,
      career_growth: filter.career_growth,
      security_clearance_required: filter.security_clearance_required,
      diversity: filter.diversity,
      other_experience: filter.other_experience,
      sites: filter.sites,
      industry: filter.industry ?? undefined,
      metadata: (filter.metadata as unknown as RoleFilterMetadataDto) ?? {
        complete: false,
        refined_prompt: '',
        original_prompt: '',
      },
      // filter_companies is a structured relation on role_filters
      // (type/company_names/dates) that doesn't map onto RoleFilterDto's
      // flat string[] shape, and isn't used by the search query builder —
      // left empty here rather than guessing a mapping.
      filter_companies: [],
      filter_location_cities: filter.filter_location_cities.map((city) => ({
        name: city.name,
        state: city.state ?? '',
        country_code: city.country_code ?? '',
      })),
    };
  }

  private dateToYear(date: Date | null): number | null {
    return date === null ? null : date.getUTCFullYear();
  }

  private async saveCandidateMatches(
    roleId: string,
    filterId: string,
    dto: RoleFilterDto,
    result: { matches: GeminiCandidateMatch[]; tokensUsed: number },
  ): Promise<role_result[]> {
    const tokensPerMatch = result.matches.length
      ? Math.round(result.tokensUsed / result.matches.length)
      : 0;

    const roleResults: role_result[] = [];
    for (const match of result.matches) {
      const candidateRecord = await this.upsertCandidate(match.candidate);
      const scoreResult = this.candidateScoringService.scoreCandidate(
        dto,
        candidateRecord,
      );
      const roleResult = await this.upsertRoleResult(
        roleId,
        filterId,
        candidateRecord.uid,
        match,
        tokensPerMatch,
        scoreResult,
      );
      roleResults.push(roleResult);
    }
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
    match: GeminiCandidateMatch,
    tokensUsed: number,
    scoreResult: CandidateScoreResult,
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
      score: scoreResult.score,
      metadata: scoreResult.breakdown as unknown as Prisma.InputJsonValue,
      tokens_used: tokensUsed,
    };

    if (existing) {
      return this.prisma.role_result.update({
        where: { uid: existing.uid },
        data,
        include: { candidate: true },
      });
    }
    return this.prisma.role_result.create({ data });
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
