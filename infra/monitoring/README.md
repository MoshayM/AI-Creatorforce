# CreatorForce Monitoring Stack

Prometheus + Grafana for the NestJS API at port 4007.

## Starting

```bash
cd infra/monitoring
docker compose -f docker-compose.monitoring.yml up -d
```

- Prometheus UI: http://localhost:9090
- Grafana UI:    http://localhost:3000  (admin / value of GRAFANA_ADMIN_PASSWORD, default: admin)

## Metrics endpoint

The API exposes metrics at:

```
GET http://localhost:4007/metrics
```

The `/metrics` path is excluded from the global `/api` prefix.
If `METRICS_TOKEN` is set in the environment, the request must include:

```
Authorization: Bearer <METRICS_TOKEN>
```

Update `prometheus.yml`'s `authorization.credentials` field with the same token
when running with the guard enabled.

## Available custom metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `cf_http_requests_total` | Counter | method, route, status | Total HTTP requests |
| `cf_http_request_duration_seconds` | Histogram | method, route | HTTP request latency |
| `cf_jobs_total` | Counter | type, status (completed\|failed) | BullMQ job outcomes |
| `cf_job_duration_seconds` | Histogram | type | BullMQ job wall time |
| `cf_ai_tokens_total` | Counter | provider, model, direction (input\|output) | AI token consumption |
| `cf_ai_cost_usd_total` | Counter | provider, model | AI spend in USD |
| `cf_ai_cache_hits_total` | Counter | kind | AI cache hits (response/embedding/transcript) |

Node.js process and event-loop metrics are also exported with the `cf_` prefix
via `collectDefaultMetrics`.

---

## Alert Rules

Alert rules are defined in `infra/monitoring/alerts.yml` and loaded via the
`rule_files` stanza in `prometheus.yml`.

| Alert | Severity | Condition | For |
|-------|----------|-----------|-----|
| `ApiDown` | critical | `up{job="creatorforce-api"} == 0` | 2m |
| `HighErrorRateWarning` | warning | 5xx share > 5 % | 5m |
| `HighErrorRateCritical` | critical | 5xx share > 20 % | 5m |
| `SlowRequests` | warning | p95 latency > 2 s | 10m |
| `JobFailureSpike` | warning | > 5 new failed jobs in 15 m | instant |
| `AiCostSpike` | warning | AI spend increase > $10 in 1 h | instant |
| `CacheHitStall` | info | cache hits == 0 while tokens flowing | 1h |

All `runbook_url` annotations point to `infra/dr/RUNBOOKS.md`.

To view firing alerts: Prometheus UI → **Alerts** tab.

---

## Service Level Objectives (SLOs)

Defined in `infra/monitoring/SLOS.md`. Summary:

| SLO | Target | Window | SLI metric |
|-----|--------|--------|------------|
| API Availability | 99.5 % | 30 days | `up{job="creatorforce-api"}` |
| p95 Read Latency | < 1 s | 30 days | `cf_http_request_duration_seconds` histogram |
| Job Success Rate | 99 % | 7 days | `cf_jobs_total` |

Error budgets and policy in `SLOS.md`.

---

## Grafana Dashboard

A provisioned dashboard is loaded automatically on Grafana start from:

```
infra/monitoring/grafana/provisioning/dashboards/creatorforce-overview.json
```

Dashboard UID: `cf-overview`. Navigate to **Dashboards → CreatorForce → CreatorForce Overview**.

Panels:
1. Request Rate by Route (req/s)
2. Error Rate % (5xx / total)
3. p95 / p50 Request Latency
4. Jobs Completed / Failed (per minute, by type)
5. AI Cost USD / Hour (by provider)
6. AI Tokens / Second by Provider and direction
7. Cache Hits / Second by Kind

The dashboard uses the `${datasource}` template variable so it works with any
Prometheus datasource configured in your Grafana instance.

---

## Backups & Disaster Recovery

DR scripts are in `infra/dr/`:

| File | Purpose |
|------|---------|
| `backup.sh` | Linux/deploy: pg_dump → dated `.dump`, prune old files, optional rclone upload |
| `restore.sh` | Linux/deploy: pg_restore with explicit `--i-understand` safety gate |
| `backup.ps1` | Windows dev: equivalent of `backup.sh` for local dev machine |
| `RUNBOOKS.md` | Step-by-step recovery procedures for every alert + DR scenario |

**RTO: 1 hour | RPO: 24 hours** (daily cron backup).

### Daily cron (server)

```cron
# /etc/cron.d/creatorforce-backup
0 2 * * * deploy /bin/bash /opt/creatorforce/infra/dr/backup.sh >> /var/log/cf-backup.log 2>&1
```

### Environment variables

See `.env.example` under `# Backups & Disaster Recovery` for:
- `BACKUP_DIR` — local dump directory (default: `./backups`)
- `BACKUP_RETENTION_DAYS` — prune threshold (default: 14)
- `RCLONE_REMOTE` — optional S3/R2/GCS destination
- `AI_COST_SPIKE_THRESHOLD_USD` — documents the alert threshold intent
