import { Injectable, Logger } from '@nestjs/common';
import { RoleFilterDto } from '../common/dto/search.dto';
import {
  GoogleSearchItem,
  GoogleSearchService,
} from '../services/google-search/google-search.service';
import {
  GeminiCandidateFields,
  GeminiCandidateMatch,
  GeminiService,
} from '../services/gemini/gemini.service';
import { PrismaService } from '../common/database/prisma.service';
import { candidate, role_result } from '../generated/prisma/client.js';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly googleSearchService: GoogleSearchService,
    private readonly geminiService: GeminiService,
    private readonly prisma: PrismaService,
  ) {}

  async search(dto: RoleFilterDto): Promise<role_result[]> {
    /*
    - build the query for each platform
      - google xray
        - Linked in
        - indeed
      - github
      - pnet ect for local
    */
    const items = await this.searchGoogle(dto);
    const formatted = await this.geminiService.formatCandidates(items, dto);
    return this.saveCandidateMatches(dto, formatted);
  }

  private async saveCandidateMatches(
    dto: RoleFilterDto,
    result: { matches: GeminiCandidateMatch[]; tokensUsed: number },
  ): Promise<role_result[]> {
    const tokensPerMatch = result.matches.length
      ? Math.round(result.tokensUsed / result.matches.length)
      : 0;

    const roleResults: role_result[] = [];
    for (const match of result.matches) {
      const candidateRecord = await this.upsertCandidate(match.candidate);
      const roleResult = await this.upsertRoleResult(
        dto.role_id,
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
      return this.prisma.candidate.create({ data });
    }

    const changed = Object.entries(data).some(
      ([key, value]) => !this.valuesEqual(existing[key], value),
    );
    if (!changed) return existing;

    return this.prisma.candidate.update({
      where: { uid: existing.uid },
      data: {
        ...data,
      },
    });
  }

  private async upsertRoleResult(
    roleId: string,
    candidateUid: string,
    match: GeminiCandidateMatch,
    tokensUsed: number,
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidateUid },
    });

    const data = {
      role_id: roleId,
      candidate_uid: candidateUid,
      summary: match.summary,
      score: match.score,
      tokens_used: tokensUsed,
    };

    if (existing) {
      return this.prisma.role_result.update({
        where: { uid: existing.uid },
        data,
        include: {
          candidate: true,
        },
      });
    }
    return this.prisma.role_result.create({ data });
  }

  // Prisma's generated candidateCreateInput/candidateUncheckedUpdateInput
  // types are too strict for a dynamically-built object (they require
  // main_source to be a literal known key, not inferred from a loop) —
  // the `as any` here is safe because every key/value pair is copied
  // straight from GeminiCandidateFields, whose shape matches the
  // candidate table's columns.
  private buildCandidateData(fields: GeminiCandidateFields): candidate {
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
    return data as candidate;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a instanceof Date || b instanceof Date) {
      return new Date(a as any).getTime() === new Date(b as any).getTime();
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((value, index) => this.valuesEqual(value, b[index]))
      );
    }
    return a === b;
  }

  private async searchGoogle(dto: RoleFilterDto): Promise<GoogleSearchItem[]> {
    return this.googleSearchService.search(dto);
  }

  private async searchGithub() {}

  private async searchPnet() {}

  private async searchDatabase() {}
}
