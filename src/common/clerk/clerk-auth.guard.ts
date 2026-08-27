import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import { type Request } from 'express';
import { type User } from '@clerk/clerk-sdk-node';
import { ClerkService } from './clerk.service.js';
import { RequestException } from '../exception/core/ExceptionBase.js';

declare module 'express' {
  interface Request {
    user?: User;
  }
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly clerkService: ClerkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new RequestException(
        'Missing bearer token',
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
      );
    }

    try {
      const payload = await this.clerkService.validateToken(token);
      request.user = await this.clerkService.getUser(payload.sub);
    } catch {
      throw new RequestException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
      );
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
