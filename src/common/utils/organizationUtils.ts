import type { ClerkAuthContext } from '../../auth/auth.types';
import { RequestException } from '../exception/core/ExceptionBase';
import { HttpStatus } from '@nestjs/common';

export const requireOrgId = (auth: ClerkAuthContext): string => {
  if (!auth.orgId) {
    throw new RequestException(
      'No active organization selected',
      HttpStatus.BAD_REQUEST,
      'NO_ACTIVE_ORGANIZATION',
    );
  }
  return auth.orgId;
};
