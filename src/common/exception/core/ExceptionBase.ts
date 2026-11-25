import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception for application-level request errors.
 * The optional `errorCode` is carried via HttpException's `options.description`
 * so it can be read by RequestExceptionFilter without extending HttpException's response body.
 */
export class RequestException extends HttpException {
  constructor(
    // An object becomes the response body (RequestExceptionFilter spreads it
    // in), for errors that carry data, e.g. { message, balance, required }.
    message: string | Record<string, unknown>,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode?: string,
  ) {
    super(message, status, { description: errorCode });
  }
}
