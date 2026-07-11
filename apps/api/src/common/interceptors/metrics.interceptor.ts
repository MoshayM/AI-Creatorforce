import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../../modules/metrics/metrics.service';

// Re-export path so app.module can import without circular concern.
// MetricsModule registers this as APP_INTERCEPTOR so it receives every request.

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    // Skip the metrics scrape endpoint itself to avoid cardinality inflation.
    if (req.path === '/metrics') {
      return next.handle();
    }

    const method = req.method;
    // Use the route pattern (e.g. /api/v1/projects/:id) not the raw URL to
    // bound label cardinality. Falls back to the raw path if routing hasn't
    // resolved yet (e.g. 404 before a route is matched).
    const route: string = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const status = String(context.switchToHttp().getResponse<{ statusCode: number }>().statusCode);
          const durationSecs = (Date.now() - start) / 1000;
          this.metricsService.httpRequestsTotal.inc({ method, route, status });
          this.metricsService.httpRequestDuration.observe({ method, route }, durationSecs);
        },
        error: () => {
          // Error status will be set by the exception filter; record as 5xx
          const durationSecs = (Date.now() - start) / 1000;
          this.metricsService.httpRequestsTotal.inc({ method, route, status: '500' });
          this.metricsService.httpRequestDuration.observe({ method, route }, durationSecs);
        },
      }),
    );
  }
}
