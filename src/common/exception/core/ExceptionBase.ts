import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception for application-level request errors.
 * The optional `errorCode` is carried via HttpException's `options.description`
 * so it can be read by RequestExceptionFilter without extending HttpException's response body.
 */
export class RequestException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode?: string,
  ) {
    super(message, status, { description: errorCode });
  }
}
