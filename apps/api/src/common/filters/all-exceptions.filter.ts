import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';

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

    // Only report 5xx errors to Sentry; 4xx are expected client errors
    if (status >= 500) {
      Sentry.captureException(exception, {
        extra: {
          method: request.method,
          url: request.url,
          body: request.body,
        },
      });
    }

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Flatten to a plain string — raw can be string, or NestJS { message, error, statusCode }
    let message: string;
    if (typeof raw === 'string') {
      message = raw;
    } else if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      const inner = r['message'];
      if (typeof inner === 'string') message = inner;
      else if (Array.isArray(inner)) message = inner.join('; ');
      else if (typeof r['error'] === 'string') message = r['error'];
      else message = 'An unexpected error occurred.';
    } else {
      message = 'An unexpected error occurred.';
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
    });
  }
}
