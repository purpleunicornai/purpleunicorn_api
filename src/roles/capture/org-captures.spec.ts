import { ExtensionCaptureStatus } from '../../generated/prisma/client';
import type { CapturedProfileDto } from './captured-profile.dto';
import { CAPTURE_TTL_MS, expiredWhere, resyncedColumns } from './org-captures';

const profile = {
  linkedinUrl: 'https://www.linkedin.com/in/x',
  name: 'X',
} as CapturedProfileDto;
const at = (iso: string) => new Date(iso);

describe('org captures', () => {
  it('pushes an unassigned capture’s expiry 30 days past its latest capture', () => {
    const columns = resyncedColumns(
      {
        captured_at: at('2026-11-01T00:00:00Z'),
        status: ExtensionCaptureStatus.CAPTURED,
      },
      { capturedAt: at('2026-11-18T00:00:00Z'), userId: 'u2', profile },
    );

    expect(columns).toMatchObject({ captured_by: 'u2' });
    expect(columns?.expires_at?.getTime()).toBe(
      at('2026-11-18T00:00:00Z').getTime() + CAPTURE_TTL_MS,
    );
  });

  it('never gives an assigned capture an expiry', () => {
    const columns = resyncedColumns(
      {
        captured_at: at('2026-11-01T00:00:00Z'),
        status: ExtensionCaptureStatus.ASSIGNED,
      },
      { capturedAt: at('2026-11-18T00:00:00Z'), userId: 'u', profile },
    );
    expect(columns?.expires_at).toBeNull();
  });

  it('ignores an older capture delivered late by the offline queue', () => {
    expect(
      resyncedColumns(
        {
          captured_at: at('2026-11-18T00:00:00Z'),
          status: ExtensionCaptureStatus.CAPTURED,
        },
        { capturedAt: at('2026-11-17T00:00:00Z'), userId: 'u', profile },
      ),
    ).toBeNull();
  });

  it('only ever expires unassigned captures, within one org', () => {
    expect(expiredWhere('org-1', at('2026-11-18T00:00:00Z'))).toEqual({
      organization_id: 'org-1',
      status: ExtensionCaptureStatus.CAPTURED,
      expires_at: { lt: at('2026-11-18T00:00:00Z') },
    });
  });
});
