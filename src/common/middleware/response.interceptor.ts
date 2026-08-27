import {
  NestInterceptor,
  Logger,
  ExecutionContext,
  CallHandler,
  Injectable,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  private readonly logger = new Logger(ResponseInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | T> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        this.log(req, res);

        // Handle void/undefined returns (e.g. from a 204 No Content)
        const finalBody = body === undefined ? {} : body;

        // 1. Check for HTML responses (don't wrap them)
        const contentType = res.getHeader('content-type');
        const isHtml =
          contentType && contentType.toString().includes('text/html');

        if (isHtml) {
          return finalBody as T;
        }

        // 2. Check if already formatted (safely cast to Record to avoid unsafe lint errors)
        const isObject = typeof finalBody === 'object' && finalBody !== null;
        const hasDataProperty =
          isObject && 'data' in (finalBody as Record<string, unknown>);

        if (hasDataProperty) {
          return finalBody as T;
        }

        // 3. Wrap normal JSON responses
        return {
          success: true,
          data: finalBody as T,
        };
      }),
    );
  }

  private log(req: Request, res: Response): void {
    const { method, url, ip } = req;
    const { statusCode } = res;

    this.logger.log(
      `${ip} - [${new Date().toISOString()}] "${method} ${url} HTTP/1.0" ${statusCode}`,
    );
  }
}
