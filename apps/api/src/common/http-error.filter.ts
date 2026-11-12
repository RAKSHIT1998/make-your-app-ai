import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const REASONS: Record<number, string> = {
  400: 'BadRequest', 401: 'Unauthorized', 402: 'PaymentRequired', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict',
  422: 'UnprocessableEntity', 429: 'TooManyRequests', 500: 'InternalServerError', 503: 'ServiceUnavailable',
};

/**
 * Every error leaves the API in one shape:
 * { statusCode, error, message, details?, requestId, ...extra }
 * Unexpected errors are logged with the request id and never leak internals.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
    res.setHeader('x-request-id', requestId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      const message = Array.isArray(obj['message']) ? (obj['message'] as string[]).join('; ') : (obj['message'] as string | undefined) ?? exception.message;
      res.status(status).json({ ...obj, statusCode: status, error: REASONS[status] ?? 'Error', message, requestId });
      return;
    }
    this.log.error(`[${requestId}] ${req.method} ${req.url}: ${exception instanceof Error ? exception.stack : String(exception)}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, error: 'InternalServerError', message: 'Something went wrong on our side. Please try again.', requestId });
  }
}
