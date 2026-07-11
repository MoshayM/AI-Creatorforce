import { Controller, Get, Req, Res, UnauthorizedException, VERSION_NEUTRAL } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Exposes Prometheus metrics at GET /metrics (outside the global /api prefix).
 *
 * Auth: if METRICS_TOKEN env is set, the request must carry
 *   Authorization: Bearer <token>
 * Otherwise the endpoint is open (suitable for local dev / private networks).
 * The token is compared with a plain string equality check — never logged.
 */
@Public()
// VERSION_NEUTRAL: URI versioning would otherwise move this to /v1/metrics,
// defeating the global-prefix exclusion that keeps the scrape path stable.
@Controller({ version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = process.env['METRICS_TOKEN'];
    if (token) {
      const authHeader = req.headers['authorization'] ?? '';
      const provided = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : '';
      if (provided !== token) {
        throw new UnauthorizedException('Invalid or missing metrics token');
      }
    }

    const output = await this.metricsService.registry.metrics();
    res.setHeader('Content-Type', this.metricsService.registry.contentType);
    res.status(200).send(output);
  }
}
