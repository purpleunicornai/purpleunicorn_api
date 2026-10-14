import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ParsedRoleFilters } from './role-filter-parser';
import { Prisma } from '../../generated/prisma/client';
import { CandidateWithHistory } from './candidate-scoring.service';

// A hard ceiling on the raw query, independent of how large the candidate
// table grows — this is a broad recall net (matches ANY one criterion, not
// all of them), so the pool still needs deterministic scoring and ranking
// afterwards before anything is sent to Gemini.
const MAX_POOL_SIZE = 200;

@Injectable()
export class ExistingCandidateSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    roleId: string,
    filters: ParsedRoleFilters,
  ): Promise<CandidateWithHistory[]> {
    const or = this.buildOrConditions(filters);
    if (or.length === 0) return [];

    return this.prisma.candidate.findMany({
      where: {
        OR: or,
        role_results: { none: { role_id: roleId } },
      },
      include: { experience: true, education: true },
      take: MAX_POOL_SIZE,
    });
  }

  // Each pushed condition is deliberately case-insensitive where Postgres
  // supports it (scalar string fields) — list fields (skills/languages) use
  // Prisma's hasSome, which has no case-insensitive mode, so casing drift
  // there just means a slightly narrower recall net, not a wrong result.
  private buildOrConditions(
    filters: ParsedRoleFilters,
  ): Prisma.candidateWhereInput[] {
    const conditions: Prisma.candidateWhereInput[] = [];

    for (const row of filters.jobTitles) {
      for (const title of row.value.titles) {
        conditions.push({
          current_title: { equals: title, mode: 'insensitive' },
        });
      }
    }

    const skills = filters.skills.flatMap((row) => row.value);
    if (skills.length > 0) {
      conditions.push({ skills: { hasSome: skills } });
    }

    const languages = filters.languages.flatMap((row) => row.value);
    if (languages.length > 0) {
      conditions.push({ languages: { hasSome: languages } });
    }

    if (filters.location?.value.countryCode) {
      conditions.push({
        current_location_country_code: filters.location.value.countryCode,
      });
    }

    for (const row of filters.companies) {
      if (row.value.type !== 'include') continue;
      for (const name of row.value.names) {
        conditions.push({
          current_company: { equals: name, mode: 'insensitive' },
        });
      }
    }

    for (const row of filters.education) {
      for (const institution of row.value.institutions) {
        conditions.push({
          education: {
            some: {
              institution_name: { contains: institution, mode: 'insensitive' },
            },
          },
        });
      }
    }

    if (filters.experience && filters.experience.value.minYears > 0) {
      conditions.push({
        experience_years: { gte: filters.experience.value.minYears },
      });
    }

    return conditions;
  }
}
