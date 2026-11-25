import {
  ExtensionCaptureStatus,
  type Prisma,
  type extension_capture,
} from '../../generated/prisma/client';
import type { CapturedProfileDto } from './captured-profile.dto';

// Prisma's Json fields need an InputJsonValue, not a class-typed DTO.
export function jsonProfile(
  profile: CapturedProfileDto,
): Prisma.InputJsonValue {
  const value: unknown = JSON.parse(JSON.stringify(profile));
  return value as Prisma.InputJsonValue;
}

// Unassigned captures are deleted this long after they were last captured
// (placeholder policy, shown in the extension and the app).
export const CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Most captures one sync request may carry.
export const SYNC_BATCH_MAX = 50;

export const expiresAt = (capturedAt: Date) =>
  new Date(capturedAt.getTime() + CAPTURE_TTL_MS);

// What the extension and app see for one org capture.
export type OrgCapture = {
  uid: string;
  slug: string;
  linkedinUrl: string;
  profile: CapturedProfileDto;
  capturedAt: string;
  capturedBy: string;
  // Captured by the user asking.
  mine: boolean;
  status: 'captured' | 'assigned';
  roleIds: string[];
  expiresAt: string | null;
};

export function orgCaptureView(
  row: extension_capture,
  userId: string,
): OrgCapture {
  return {
    uid: row.uid,
    slug: row.linkedin_slug,
    linkedinUrl: row.linkedin_url,
    profile: row.profile as unknown as CapturedProfileDto,
    capturedAt: row.captured_at.toISOString(),
    capturedBy: row.captured_by,
    mine: row.captured_by === userId,
    status:
      row.status === ExtensionCaptureStatus.ASSIGNED ? 'assigned' : 'captured',
    roleIds: row.role_ids,
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}

// The columns a sync writes for an existing row. A sync never moves
// captured_at backwards (an offline queue can deliver an older capture
// late), and only an unassigned capture gets a new expiry.
export function resyncedColumns(
  existing: Pick<extension_capture, 'captured_at' | 'status'>,
  incoming: { capturedAt: Date; userId: string; profile: CapturedProfileDto },
) {
  if (incoming.capturedAt <= existing.captured_at) return null;
  return {
    captured_by: incoming.userId,
    profile: jsonProfile(incoming.profile),
    captured_at: incoming.capturedAt,
    expires_at:
      existing.status === ExtensionCaptureStatus.ASSIGNED
        ? null
        : expiresAt(incoming.capturedAt),
  };
}

// Unassigned and past its expiry: never returned, deleted on the next read.
export const expiredWhere = (organizationId: string, now: Date) => ({
  organization_id: organizationId,
  status: ExtensionCaptureStatus.CAPTURED,
  expires_at: { lt: now },
});
