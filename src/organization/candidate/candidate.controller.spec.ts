import { ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { CandidateController } from './candidate.controller';
import type { CandidateService } from './candidate.service';

const auth = (orgId?: string): ClerkAuthContext => ({
  userId: 'user-1',
  orgId,
  claims: {},
});

describe('CandidateController', () => {
  const service = {
    contactDetails: jest.fn().mockResolvedValue({ email: 'jane@acme.com' }),
  };
  const controller = new CandidateController(
    service as unknown as CandidateService,
  );

  it('requires a signed-in user on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CandidateController)).toEqual([
      ClerkAuthGuard,
    ]);
  });

  it('serves contact details as a read (GET), validating the id as a UUID', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CandidateController.prototype,
      'contactDetails',
    )?.value;
    const method: unknown = Reflect.getMetadata(
      METHOD_METADATA,
      handler as object,
    );
    expect(method).toBe(RequestMethod.GET);
    const metadata: unknown = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      CandidateController,
      'contactDetails',
    );
    const args = Object.values(
      metadata as Record<string, { data?: string; pipes?: unknown[] }>,
    );
    expect(args.find((arg) => arg.data === 'candidateId')?.pipes).toEqual([
      ParseUUIDPipe,
    ]);
  });

  it('reads contact details within the caller’s active organization', async () => {
    await expect(
      controller.contactDetails('candidate-1', auth('org-1')),
    ).resolves.toEqual({ email: 'jane@acme.com' });
    expect(service.contactDetails).toHaveBeenCalledWith('org-1', 'candidate-1');
  });

  it('refuses a caller with no active organization', () => {
    expect(() => controller.contactDetails('candidate-1', auth())).toThrow();
  });
});
