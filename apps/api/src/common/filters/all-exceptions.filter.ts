import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { currentCorrelationId } from '../correlation.context';

/**
 * Error envelope (docs4/32): { code, message, details, correlationId,
 * retryable } plus the legacy { success, statusCode } fields existing clients
 * read. `code` is a stable machine category; `retryable` is the spec's
 * retry-guidance flag (rate-limit and internal/provider errors are worth
 * retrying, client errors are not).
 */
export function categorize(status: number): { code: string; retryable: boolean } {
  switch (status) {
    case HttpStatus.BAD_REQUEST: return { code: 'VALIDATION', retryable: false };
    case HttpStatus.UNAUTHORIZED: return { code: 'AUTH', retryable: false };
    case HttpStatus.FORBIDDEN: return { code: 'FORBIDDEN', retryable: false };
    case HttpStatus.NOT_FOUND: return { code: 'NOT_FOUND', retryable: false };
    case HttpStatus.CONFLICT: return { code: 'CONFLICT', retryable: false };
    case HttpStatus.PAYLOAD_TOO_LARGE: return { code: 'TOO_LARGE', retryable: false };
    case HttpStatus.TOO_MANY_REQUESTS: return { code: 'RATE_LIMITED', retryable: true };
    case HttpStatus.SERVICE_UNAVAILABLE:
    case HttpStatus.GATEWAY_TIMEOUT:
    case HttpStatus.BAD_GATEWAY: return { code: 'PROVIDER', retryable: true };
    default:
      return status >= 500
        ? { code: 'INTERNAL', retryable: true }
        : { code: 'CLIENT_ERROR', retryable: false };
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const correlationId = currentCorrelationId() ?? null;

    // Only report 5xx errors to Sentry; 4xx are expected client errors
    if (status >= 500) {
      Sentry.captureException(exception, {
        extra: {
          method: request.method,
          url: request.url,
          body: request.body,
          correlationId,
        },
      });
    }

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Flatten to a plain string — raw can be string, or NestJS { message, error, statusCode }
    let message: string;
    let details: unknown = undefined;
    if (typeof raw === 'string') {
      message = raw;
    } else if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      const inner = r['message'];
      if (typeof inner === 'string') message = inner;
      else if (Array.isArray(inner)) {
        // ValidationPipe emits one message per failed constraint — the array
        // is the machine-readable detail, the join is the human summary.
        message = inner.join('; ');
        details = inner;
      } else if (typeof r['error'] === 'string') message = r['error'];
      else message = 'An unexpected error occurred.';
    } else {
      message = 'An unexpected error occurred.';
    }

    const { code, retryable } = categorize(status);

    response.status(status).json({
      success: false,
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      correlationId,
      retryable,
    });
  }
}
