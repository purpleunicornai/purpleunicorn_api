import type { ClerkAuthContext } from '../../auth/auth.types';
import type { RolesService } from '../roles.service';
import type { CapturedProfileDto } from './captured-profile.dto';
import { ExtensionController } from './extension.controller';
import type { ProfileCaptureService } from './profile-capture.service';
import type { OrgCapturesService } from './org-captures.service';

const AUTH = { userId: 'user-1', orgId: 'org-1' } as ClerkAuthContext;
const PROFILE = {
  linkedinUrl: 'https://www.linkedin.com/in/x',
  name: 'X',
} as CapturedProfileDto;

function setup(getRole: jest.Mock) {
  const captures = {
    capture: jest.fn().mockResolvedValue({ resultId: 'r' }),
    membership: jest.fn().mockResolvedValue({ candidateId: null, roles: [] }),
  };
  const orgCaptures = {
    markAssigned: jest.fn().mockResolvedValue(undefined),
    sync: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue([]),
  };
  const controller = new ExtensionController(
    { getRole } as unknown as RolesService,
    captures as unknown as ProfileCaptureService,
    orgCaptures as unknown as OrgCapturesService,
  );
  return { controller, captures, orgCaptures };
}

describe('ExtensionController', () => {
  it('captures only into a role the user can reach in their org', async () => {
    const getRole = jest.fn().mockResolvedValue({ uid: 'role-1' });
    const { controller, captures } = setup(getRole);

    await expect(controller.capture('role-1', PROFILE, AUTH)).resolves.toEqual({
      resultId: 'r',
    });
    expect(getRole).toHaveBeenCalledWith('role-1', 'org-1', 'user-1');
    expect(captures.capture).toHaveBeenCalledWith('role-1', PROFILE);
  });

  it('keeps the org capture once it is added to a role', async () => {
    const { controller, orgCaptures } = setup(
      jest.fn().mockResolvedValue({ uid: 'role-1' }),
    );

    await controller.capture('role-1', PROFILE, AUTH);

    expect(orgCaptures.markAssigned).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      PROFILE,
      'role-1',
    );
  });

  it('syncs and lists captures in the caller’s active org only', async () => {
    const { controller, orgCaptures } = setup(jest.fn());
    const capture = { ...PROFILE, capturedAt: '2026-11-18T10:00:00Z' };

    await controller.sync({ captures: [capture] }, AUTH);
    await controller.list(AUTH);

    expect(orgCaptures.sync).toHaveBeenCalledWith('org-1', 'user-1', [capture]);
    expect(orgCaptures.list).toHaveBeenCalledWith('org-1', 'user-1');
    await expect(
      controller.list({ userId: 'user-1' } as ClerkAuthContext),
    ).rejects.toBeDefined();
  });

  it('writes nothing when the role is out of reach', async () => {
    const getRole = jest.fn().mockRejectedValue(new Error('ROLE_NOT_FOUND'));
    const { controller, captures, orgCaptures } = setup(getRole);

    await expect(controller.capture('role-1', PROFILE, AUTH)).rejects.toThrow(
      'ROLE_NOT_FOUND',
    );
    expect(captures.capture).not.toHaveBeenCalled();
    expect(orgCaptures.markAssigned).not.toHaveBeenCalled();
  });

  it('needs an active organisation', async () => {
    const { controller } = setup(jest.fn());
    await expect(
      controller.lookup({ url: PROFILE.linkedinUrl }, {
        userId: 'user-1',
      } as ClerkAuthContext),
    ).rejects.toBeDefined();
  });
});
