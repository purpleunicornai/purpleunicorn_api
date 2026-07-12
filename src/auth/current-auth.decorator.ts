import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ClerkAuthContext } from './auth.types';

/**
 * Controller-method parameter decorator that exposes the verified Clerk
 * auth context attached by `ClerkAuthGuard`.
 *
 *   @Post('search')
 *   search(@CurrentAuth() auth: ClerkAuthContext, @Body() dto: SearchDto) { ... }
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClerkAuthContext | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.auth;
  },
);
