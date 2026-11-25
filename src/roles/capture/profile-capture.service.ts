import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { ProjectsService } from '../../projects/projects.service';
import { Prisma, SourceType } from '../../generated/prisma/client';
import {
  CandidateScoringService,
  scoringFactsOf,
} from '../search/candidate-scoring.service';
import { parseRoleFilters } from '../search/role-filter-parser';
import {
  parseResearchFacts,
  rescoreWithResearch,
  searchScoreOf,
} from '../search/research-rescore';
import { scoreBreakdownRows, scoreColumns } from '../search/score-persistence';
import type { CapturedProfileDto } from './captured-profile.dto';
import {
  type CaptureScore,
  type ProfileMembership,
  canonicalProfileUrl,
  captureView,
  capturedCandidateFields,
  capturedEducationRows,
  capturedExperienceRows,
  profileSlug,
  profileUrlEndings,
} from './profile-capture';

export const EXTENSION_SOURCE = 'Chrome extension';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

// Profiles the Chrome extension captured off LinkedIn, added to a role and
// scored by the fixed algorithm. No AI call and no credits: the score is
// the same deterministic one search uses, so it is free and instant.
@Injectable()
export class ProfileCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: CandidateScoringService,
    private readonly projects: ProjectsService,
  ) {}

  // Caller has already checked the role is in the user's org. Idempotent:
  // capturing the same profile into the same role again refreshes the
  // candidate and re-scores the one role_result, keeping deep research.
  async capture(
    roleId: string,
    profile: CapturedProfileDto,
  ): Promise<CaptureScore> {
    const slug = requireSlug(profile.linkedinUrl);
    const filterSet = await this.prisma.role_filters.findFirst({
      where: { role_id: roleId, archived: false },
      include: { role_filter_items: { include: { children: true } } },
    });
    if (!filterSet) {
      throw new RequestException(
        'This role has no filters to score against yet',
        HttpStatus.NOT_FOUND,
        'ROLE_FILTER_NOT_FOUND',
      );
    }
    const filters = parseRoleFilters(filterSet.role_filter_items);
    const candidate = await this.upsertCandidate(slug, profile);
    const existing = await this.prisma.role_result.findFirst({
      where: { role_id: roleId, candidate_uid: candidate.uid },
    });

    const facts = scoringFactsOf(candidate);
    const previous = asRecord(existing?.metadata);
    const { search, final, researchBefore } = rescoreWithResearch(
      this.scoring,
      filters,
      facts,
      parseResearchFacts(previous.researchEvidence),
    );
    const view = captureView(filters, facts, final);
    const data = {
      filter_id: filterSet.uid,
      ...scoreColumns(final),
      skills_matched: view.matchedSkills,
      metadata: {
        ...previous,
        searchEvidence: facts,
        searchScore: searchScoreOf(search),
      } as Prisma.InputJsonObject,
    };
    const result = existing
      ? await this.prisma.role_result.update({
          where: { uid: existing.uid },
          data: {
            ...data,
            sources: [...new Set([...existing.sources, EXTENSION_SOURCE])],
          },
        })
      : await this.prisma.role_result.create({
          data: {
            ...data,
            role_id: roleId,
            candidate_uid: candidate.uid,
            sources: [EXTENSION_SOURCE],
          },
        });

    await this.prisma.role_result_score_breakdown.deleteMany({
      where: { role_result_id: result.uid },
    });
    if (final.breakdown.length > 0) {
      await this.prisma.role_result_score_breakdown.createMany({
        data: scoreBreakdownRows(
          result.uid,
          filterSet.uid,
          final.breakdown,
          researchBefore,
        ),
      });
    }

    return {
      roleId,
      resultId: result.uid,
      candidateId: candidate.uid,
      alreadyInRole: !!existing,
      shortlisted: !!result.shortlist,
      ...view,
    };
  }

  // Every role in the org, visible to this user, the profile is already in.
  async membership(
    linkedinUrl: string,
    orgId: string,
    userId: string,
  ): Promise<ProfileMembership> {
    const slug = requireSlug(linkedinUrl);
    const candidate = await this.prisma.candidate.findFirst({
      where: bySlug(slug),
      select: { uid: true },
    });
    if (!candidate) return { candidateId: null, roles: [] };

    const results = await this.prisma.role_result.findMany({
      where: {
        candidate_uid: candidate.uid,
        role: {
          project: {
            organization_id: orgId,
            ...this.projects.visibleToUser(userId),
          },
        },
      },
      include: { role: { include: { project: true } } },
      orderBy: { updated: 'desc' },
    });
    return {
      candidateId: candidate.uid,
      roles: results.map((result) => ({
        roleId: result.role_id,
        roleName: result.role.name,
        projectId: result.role.project_id,
        projectName: result.role.project.name,
        resultId: result.uid,
        score: result.score,
        shortlisted: !!result.shortlist,
      })),
    };
  }

  // A capture is matched on its LinkedIn URL only: unlike search, never on
  // name, since the extension always has the exact profile URL.
  private async upsertCandidate(slug: string, profile: CapturedProfileDto) {
    const fields = capturedCandidateFields(profile);
    const experience = capturedExperienceRows(profile);
    const education = capturedEducationRows(profile);
    const include = { experience: true, education: true } as const;
    const existing = await this.prisma.candidate.findFirst({
      where: bySlug(slug),
      include,
    });

    if (!existing) {
      return this.prisma.candidate.create({
        data: {
          ...fields,
          sources: {
            create: [
              {
                title: [profile.name, profile.headline]
                  .filter(Boolean)
                  .join(' - '),
                source: 'LinkedIn',
                url: canonicalProfileUrl(slug),
                main: true,
                type: SourceType.PLUGIN,
              },
            ],
          },
          ...(experience.length > 0
            ? { experience: { create: experience } }
            : {}),
          ...(education.length > 0 ? { education: { create: education } } : {}),
        },
        include,
      });
    }

    // The live page is the freshest view of scalar fields, but skills are
    // merged and history rows are only added when none exist, so a capture
    // never drops what search or deep research found.
    return this.prisma.candidate.update({
      where: { uid: existing.uid },
      data: {
        ...fields,
        ...(fields.skills
          ? { skills: [...new Set([...existing.skills, ...fields.skills])] }
          : {}),
        ...(existing.experience.length === 0 && experience.length > 0
          ? { experience: { create: experience } }
          : {}),
        ...(existing.education.length === 0 && education.length > 0
          ? { education: { create: education } }
          : {}),
      },
      include,
    });
  }
}

function requireSlug(linkedinUrl: string): string {
  const slug = profileSlug(linkedinUrl);
  if (!slug) {
    throw new RequestException(
      'Not a LinkedIn profile URL',
      HttpStatus.BAD_REQUEST,
      'NOT_A_LINKEDIN_PROFILE',
    );
  }
  return slug;
}

function bySlug(slug: string): Prisma.candidateWhereInput {
  return {
    sources: {
      some: {
        OR: profileUrlEndings(slug).map((ending) => ({
          url: { endsWith: ending, mode: 'insensitive' as const },
        })),
      },
    },
  };
}
