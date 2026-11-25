import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { ExtensionCaptureStatus } from '../../generated/prisma/client';
import type { CapturedProfileDto } from './captured-profile.dto';
import {
  expiredWhere,
  expiresAt,
  jsonProfile,
  orgCaptureView,
  resyncedColumns,
  type OrgCapture,
} from './org-captures';
import type { SyncedCaptureDto } from './org-captures.dto';
import { canonicalProfileUrl, profileSlug } from './profile-capture';

const LIST_LIMIT = 200;

// Captures saved for the whole org. Expired unassigned captures are purged
// lazily: every list and sync first deletes the org's expired rows (one
// indexed deleteMany), and reads filter them out regardless, so nothing
// past its expiry is ever returned even if a purge is skipped.
@Injectable()
export class OrgCapturesService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(
    organizationId: string,
    userId: string,
    captures: SyncedCaptureDto[],
    now = new Date(),
  ): Promise<OrgCapture[]> {
    await this.purge(organizationId, now);
    const synced: OrgCapture[] = [];
    for (const { capturedAt, ...profile } of captures) {
      const slug = slugOf(profile.linkedinUrl);
      // A capture can't be dated in the future (a skewed device clock).
      const at = new Date(Math.min(Date.parse(capturedAt), now.getTime()));
      synced.push(
        orgCaptureView(
          await this.upsert(organizationId, userId, slug, profile, at),
          userId,
        ),
      );
    }
    return synced;
  }

  async list(
    organizationId: string,
    userId: string,
    now = new Date(),
  ): Promise<OrgCapture[]> {
    await this.purge(organizationId, now);
    const rows = await this.prisma.extension_capture.findMany({
      where: {
        organization_id: organizationId,
        NOT: expiredWhere(organizationId, now),
      },
      orderBy: { captured_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((row) => orgCaptureView(row, userId));
  }

  // Called after "Add to role": the capture is kept from now on.
  async markAssigned(
    organizationId: string,
    userId: string,
    profile: CapturedProfileDto,
    roleId: string,
    now = new Date(),
  ): Promise<void> {
    const slug = slugOf(profile.linkedinUrl);
    const row = await this.upsert(organizationId, userId, slug, profile, now);
    await this.prisma.extension_capture.update({
      where: { uid: row.uid },
      data: {
        status: ExtensionCaptureStatus.ASSIGNED,
        expires_at: null,
        role_ids: row.role_ids.includes(roleId)
          ? row.role_ids
          : [...row.role_ids, roleId],
      },
    });
  }

  // Any member can remove one capture from the org.
  async remove(organizationId: string, slug: string): Promise<number> {
    const { count } = await this.prisma.extension_capture.deleteMany({
      where: { organization_id: organizationId, linkedin_slug: slug },
    });
    return count;
  }

  // "Clear captured data": the user's own unassigned captures. Captures in
  // a role, and teammates' captures, stay.
  async clearMine(organizationId: string, userId: string): Promise<number> {
    const { count } = await this.prisma.extension_capture.deleteMany({
      where: {
        organization_id: organizationId,
        captured_by: userId,
        status: ExtensionCaptureStatus.CAPTURED,
      },
    });
    return count;
  }

  private purge(organizationId: string, now: Date) {
    return this.prisma.extension_capture.deleteMany({
      where: expiredWhere(organizationId, now),
    });
  }

  private async upsert(
    organizationId: string,
    userId: string,
    slug: string,
    profile: CapturedProfileDto,
    capturedAt: Date,
  ) {
    const key = {
      organization_id_linkedin_slug: {
        organization_id: organizationId,
        linkedin_slug: slug,
      },
    };
    const existing = await this.prisma.extension_capture.findUnique({
      where: key,
    });
    if (!existing) {
      // upsert, not create: two syncs of a new profile can race.
      return this.prisma.extension_capture.upsert({
        where: key,
        create: {
          organization_id: organizationId,
          captured_by: userId,
          linkedin_slug: slug,
          linkedin_url: canonicalProfileUrl(slug),
          profile: jsonProfile(profile),
          captured_at: capturedAt,
          expires_at: expiresAt(capturedAt),
        },
        update: {},
      });
    }
    const columns = resyncedColumns(existing, { capturedAt, userId, profile });
    if (!columns) return existing;
    return this.prisma.extension_capture.update({
      where: { uid: existing.uid },
      data: columns,
    });
  }
}

function slugOf(url: string): string {
  const slug = profileSlug(url);
  if (!slug) {
    throw new RequestException(
      'Only linkedin.com/in/ profiles can be captured',
      HttpStatus.BAD_REQUEST,
      'NOT_A_LINKEDIN_PROFILE',
    );
  }
  return slug;
}
