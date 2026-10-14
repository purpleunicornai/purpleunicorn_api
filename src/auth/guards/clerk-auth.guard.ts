import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ClerkAuthContext } from '../auth.types';
import type { Request } from 'express';
import { ClerkService } from '../../common/clerk/clerk.service';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(private clerkService: ClerkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(req);

    this.logger.debug(`Validating token: ${token}`);

    if (!token) {
      throw new UnauthorizedException(
        'Missing or malformed Authorization header',
      );
    }

    try {
      const payload = await this.clerkService.validateToken(token);

      const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!sub) {
        throw new UnauthorizedException('Token is missing a subject claim');
      }

      const organization = payload.o as {
        id: string;
        rol: string;
        slg: string;
      };

      const auth: ClerkAuthContext = {
        userId: sub,
        sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
        orgId:
          typeof organization.id === 'string' ? organization.id : undefined,
        orgRole:
          typeof organization.rol === 'string' ? organization.rol : undefined,
        claims: payload,
      };
      req.auth = auth;
      return true;
    } catch (err) {
      // Don't leak verification internals to the caller, but do log them.
      this.logger.warn(
        `Clerk token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid or expired Clerk token');
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header =
    req.headers['authorization'] ?? req.headers['Authorization' as never];
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
