import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  RoleFilterDto,
  RoleFilterMetadataDto,
} from '../../common/dto/search.dto';
import { GoogleSearchService } from '../../services/google-search/google-search.service';
import {
  GeminiCandidateFields,
  GeminiCandidateMatch,
  GeminiService,
} from '../../services/gemini/gemini.service';
import { PrismaService } from '../../common/database/prisma.service';
import {
  candidate,
  filter_location_cities,
  Prisma,
  role_filters,
  role_result,
  roles,
} from '../../generated/prisma/client.js';
import { RequestException } from '../../common/exception/core/ExceptionBase';

type StoredFilter = role_filters & {
  filter_location_cities: filter_location_cities[];
};

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly googleSearchService: GoogleSearchService,
    private readonly geminiService: GeminiService,
    private readonly prisma: PrismaService,
  ) {}

  async search(filterId: string, role: roles): Promise<role_result[]> {
    const filter = await this.getRoleFilter(filterId);
    const dto = this.toRoleFilterDto(filter);
    const items = await this.googleSearchService.search(dto);
    const formatted = await this.geminiService.formatCandidates(items, dto);
    return this.saveCandidateMatches(role.uid, filter.uid, formatted);
  }

  private async getRoleFilter(filterId: string): Promise<StoredFilter> {
    const filter = await this.prisma.role_filters.findFirst({
      where: { uid: filterId },
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
      uid: filter.uid,
      created: filter.created.toISOString(),
      updated: filter.updated.toISOString(),
      role_id: filter.role_id,
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
      education_universities: filter.education_universities,
      education_excluded_universities: filter.education_excluded_universities,
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
        uid: city.uid,
        created: city.created.toISOString(),
        updated: city.updated.toISOString(),
        role_filters_id: city.role_filters_id,
        name: city.name,
        state: city.state ?? '',
        postcode: city.postcode ?? '',
        distance_unit: city.distance_unit ?? '',
        distance_value: city.distance_value ?? 0,
      })),
    };
  }

  private dateToYear(date: Date | null): number | null {
    return date === null ? null : date.getUTCFullYear();
  }

  private async saveCandidateMatches(
    roleId: string,
    filterId: string,
    result: { matches: GeminiCandidateMatch[]; tokensUsed: number },
  ): Promise<role_result[]> {
    const tokensPerMatch = result.matches.length
      ? Math.round(result.tokensUsed / result.matches.length)
      : 0;

    const roleResults: role_result[] = [];
    for (const match of result.matches) {
      const candidateRecord = await this.upsertCandidate(match.candidate);
      const roleResult = await this.upsertRoleResult(
        roleId,
        filterId,
        candidateRecord.uid,
        match,
        tokensPerMatch,
      );
      roleResults.push(roleResult);
    }
    return roleResults;
  }

  private async upsertCandidate(
    fields: GeminiCandidateFields,
  ): Promise<candidate> {
    const data = this.buildCandidateData(fields);
    const existing = fields.original_source_url
      ? await this.prisma.candidate.findFirst({
          where: { original_source_url: fields.original_source_url },
        })
      : null;

    if (!existing) {
      return this.prisma.candidate.create({
        data: data as Prisma.candidateCreateInput,
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
    });
  }

  private async upsertRoleResult(
    roleId: string,
    filterId: string,
    candidateUid: string,
    match: GeminiCandidateMatch,
    tokensUsed: number,
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidateUid },
    });

    const data = {
      role_id: roleId,
      filter_id: filterId,
      candidate_uid: candidateUid,
      summary: match.summary,
      score: match.score,
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
  // main_source to be a literal known key, not inferred from a loop), so
  // this returns a plain Record and the two .create()/.update() call sites
  // below cast it — every key/value pair is copied straight from
  // GeminiCandidateFields, whose shape matches the candidate table's columns.
  private buildCandidateData(
    fields: GeminiCandidateFields,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (key === 'current_role_start_date') {
        data[key] = new Date(value as string);
      } else if (key === 'graduation_years') {
        data[key] = (value as string[]).map((date) => new Date(date));
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
