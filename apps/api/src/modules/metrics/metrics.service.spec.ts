import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    // Trigger collectDefaultMetrics registration
    service.onModuleInit();
  });

  afterEach(async () => {
    // Clear the registry between tests to avoid duplicate-metric errors
    service.registry.clear();
  });

  it('should include cf_http_requests_total in metrics output', async () => {
    service.httpRequestsTotal.inc({ method: 'GET', route: '/api/v1/test', status: '200' });
    const output = await service.registry.metrics();
    expect(output).toContain('cf_http_requests_total');
    expect(output).toContain('method="GET"');
    expect(output).toContain('route="/api/v1/test"');
    expect(output).toContain('status="200"');
  });

  it('should include cf_http_request_duration_seconds in metrics output', async () => {
    service.httpRequestDuration.observe({ method: 'POST', route: '/api/v1/jobs' }, 0.42);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_http_request_duration_seconds');
    expect(output).toContain('method="POST"');
  });

  it('should include cf_jobs_total in metrics output after recordJob', async () => {
    service.recordJob('SCRIPT', 'completed', 8500);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_jobs_total');
    expect(output).toContain('type="SCRIPT"');
    expect(output).toContain('status="completed"');
  });

  it('should include cf_job_duration_seconds in metrics output after recordJob', async () => {
    service.recordJob('RENDER', 'completed', 45000);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_job_duration_seconds');
    expect(output).toContain('type="RENDER"');
  });

  it('should include cf_jobs_total for failed jobs', async () => {
    service.recordJob('RESEARCH', 'failed', 1200);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_jobs_total');
    expect(output).toContain('status="failed"');
  });

  it('should include cf_ai_tokens_total in metrics output after recordAiUsage', async () => {
    service.recordAiUsage('anthropic', 'claude-3-5-sonnet-20241022', 500, 1200, 0.0045);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_ai_tokens_total');
    expect(output).toContain('provider="anthropic"');
    expect(output).toContain('model="claude-3-5-sonnet-20241022"');
    expect(output).toContain('direction="input"');
    expect(output).toContain('direction="output"');
  });

  it('should include cf_ai_cost_usd_total in metrics output after recordAiUsage', async () => {
    service.recordAiUsage('openai', 'gpt-4o', 300, 800, 0.0021);
    const output = await service.registry.metrics();
    expect(output).toContain('cf_ai_cost_usd_total');
    expect(output).toContain('provider="openai"');
    expect(output).toContain('model="gpt-4o"');
  });

  it('should include default node/process metrics with cf_ prefix', async () => {
    const output = await service.registry.metrics();
    // collectDefaultMetrics registers process_cpu_seconds_total etc. with prefix cf_
    expect(output).toContain('cf_process_');
  });
});
