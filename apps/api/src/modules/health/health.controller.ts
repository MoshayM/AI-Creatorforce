import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AGENT_QUEUE } from '../jobs/jobs.constants';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Probe endpoints (docs4/39): GET /health (liveness — process is up) and
 * GET /ready (readiness — DB + Redis reachable).  Outside the /api prefix
 * and unversioned, same as /metrics, so load balancers and the runbooks'
 * `curl -f http://localhost:4007/health` work without knowing the API
 * versioning scheme.  No auth: they leak nothing beyond up/down.
 */
@Public()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue,
  ) {}

  /** Liveness: the process answers. Never touches dependencies. */
  @Get('health')
  health() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }

  /** Readiness: hard dependencies answer. 503 with per-check detail when not. */
  @Get('ready')
  async ready() {
    const checks: Record<string, 'ok' | 'down'> = { database: 'down', redis: 'down' };

    await this.prisma.$queryRaw`SELECT 1`
      .then(() => (checks['database'] = 'ok'))
      .catch(() => undefined);

    // BullMQ types the connection as a minimal IRedisClient; it is an ioredis
    // client at runtime, and ping() is the standard reachability probe.
    await this.queue.client
      .then((c) => (c as unknown as { ping(): Promise<string> }).ping())
      .then(() => (checks['redis'] = 'ok'))
      .catch(() => undefined);

    const ready = Object.values(checks).every((v) => v === 'ok');
    if (!ready) throw new ServiceUnavailableException({ status: 'not-ready', checks });
    return { status: 'ready', checks };
  }
}
