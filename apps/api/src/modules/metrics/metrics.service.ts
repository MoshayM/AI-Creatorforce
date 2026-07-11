import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry: Registry = new Registry();

  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly httpRequestDuration: Histogram<'method' | 'route'>;
  readonly jobsTotal: Counter<'type' | 'status'>;
  readonly jobDuration: Histogram<'type'>;
  readonly aiTokensTotal: Counter<'provider' | 'model' | 'direction'>;
  readonly aiCostUsdTotal: Counter<'provider' | 'model'>;
  readonly aiCacheHitsTotal: Counter<'kind'>;

  constructor() {
    this.httpRequestsTotal = new Counter({
      name: 'cf_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'cf_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.jobsTotal = new Counter({
      name: 'cf_jobs_total',
      help: 'Total BullMQ jobs processed',
      labelNames: ['type', 'status'] as const,
      registers: [this.registry],
    });

    this.jobDuration = new Histogram({
      name: 'cf_job_duration_seconds',
      help: 'BullMQ job processing duration in seconds',
      labelNames: ['type'] as const,
      buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800],
      registers: [this.registry],
    });

    this.aiTokensTotal = new Counter({
      name: 'cf_ai_tokens_total',
      help: 'Total AI tokens consumed',
      labelNames: ['provider', 'model', 'direction'] as const,
      registers: [this.registry],
    });

    this.aiCostUsdTotal = new Counter({
      name: 'cf_ai_cost_usd_total',
      help: 'Total AI cost in USD',
      labelNames: ['provider', 'model'] as const,
      registers: [this.registry],
    });

    this.aiCacheHitsTotal = new Counter({
      name: 'cf_ai_cache_hits_total',
      help: 'Total AI cache hits (response or embedding) — pure margin, no provider call made',
      labelNames: ['kind'] as const,
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: 'cf_' });
  }

  recordJob(type: string, status: 'completed' | 'failed', durationMs: number): void {
    this.jobsTotal.inc({ type, status });
    this.jobDuration.observe({ type }, durationMs / 1000);
  }

  recordAiUsage(provider: string, model: string, tokensIn: number, tokensOut: number, costUsd: number): void {
    this.aiTokensTotal.inc({ provider, model, direction: 'input' }, tokensIn);
    this.aiTokensTotal.inc({ provider, model, direction: 'output' }, tokensOut);
    this.aiCostUsdTotal.inc({ provider, model }, costUsd);
  }

  recordAiCacheHit(kind: 'response' | 'embedding'): void {
    this.aiCacheHitsTotal.inc({ kind });
  }
}
