import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Convert bytes into MB
const MEGABYTE_FACTOR = 1024 * 1024;
// Convert milliseconds into seconds
const SECONDS_FACTOR = 1000;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();

    return next.handle().pipe(
      tap((data) => {
        const contentLength = JSON.stringify(data).length;
        const responseSizeInMB = contentLength / MEGABYTE_FACTOR;
        const elapsedTimeInSeconds = (Date.now() - now) / SECONDS_FACTOR;

        console.log(`Response size: ${responseSizeInMB.toFixed(2)} MB`);
        console.log(`Elapsed time: ${elapsedTimeInSeconds.toFixed(2)} seconds`);
      }),
    );
  }
}
