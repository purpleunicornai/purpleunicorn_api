import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';
import { RequestException } from '../exception/core/ExceptionBase.js';

interface ExceptionWithOptions {
  options?: {
    description?: string;
  };
}

@Catch(RequestException)
export class RequestExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter', { timestamp: true });

  catch(exception: RequestException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const code = exception.getStatus(); // Default to 500 if no status is set
    const msg = exception.getResponse();

    // Safely extract options by casting to a known shape
    const exceptionWithOptions = exception as unknown as ExceptionWithOptions;
    const errorCode = exceptionWithOptions.options?.description;

    let obj;
    if (typeof msg === 'string') {
      obj = {
        success: false,
        statusCode: code,
        message: msg,
        errorCode,
      };
    } else {
      obj = {
        success: false,
        ...msg,
        errorCode,
      };
    }

    res.status(code).json(obj);
  }
}
