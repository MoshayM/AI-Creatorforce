# CreatorForce — Service Level Objectives (SLOs)

> Metric names reference `apps/api/src/modules/metrics/metrics.service.ts`.
> All PromQL expressions assume the Prometheus datasource provisioned at `http://prometheus:9090`.

---

## SLO 1 — API Availability ≥ 99.5 % (30-day rolling)

| Field | Value |
|-------|-------|
| **SLO target** | 99.5 % of minutes the API scrape is reachable |
| **Error budget** | 0.5 % × 43 200 min/month ≈ **216 minutes/month** downtime allowed |
| **Window** | 30-day rolling |
| **SLI (PromQL)** | `avg_over_time(up{job="creatorforce-api"}[30d])` |
| **Guards** | `ApiDown` alert (critical, fires after 2 m absence) |

**Interpretation:** each minute Prometheus records `up == 0` burns 1 minute of error budget.
When fewer than ~3.5 hours of budget remain in the current window, the `ApiDown` alert has
already fired and the on-call engineer must act to avoid breaching the SLO.

---

## SLO 2 — p95 Read-Endpoint Latency < 1 s (30-day rolling)

| Field | Value |
|-------|-------|
| **SLO target** | 95 % of read-endpoint requests complete in < 1 s |
| **Error budget** | 5 % of requests may exceed 1 s |
| **Window** | 30-day rolling |
| **SLI (PromQL — good requests ratio)** | See below |
| **Guards** | `SlowRequests` alert (warning, fires when p95 > 2 s for 10 m) |

**SLI expression (ratio of requests under 1 s):**
```promql
sum(rate(cf_http_request_duration_seconds_bucket{le="1"}[30d]))
/
sum(rate(cf_http_request_duration_seconds_count[30d]))
```

**Scope:** all HTTP requests (read and write). To narrow to read-only routes, add
`method=~"GET|HEAD"` to both selectors.

**Alert threshold note:** `SlowRequests` fires at p95 > 2 s (a conservative trigger)
to give early warning before the SLO ceiling of 1 s is breached at scale.

---

## SLO 3 — BullMQ Job Success Rate ≥ 99 % (7-day rolling)

| Field | Value |
|-------|-------|
| **SLO target** | 99 % of BullMQ jobs complete with `status="completed"` |
| **Error budget** | 1 % of jobs may fail over any 7-day window |
| **Window** | 7-day rolling |
| **SLI (PromQL)** | See below |
| **Guards** | `JobFailureSpike` alert (warning, fires when > 5 new failures in 15 m) |

**SLI expression (success ratio):**
```promql
sum(rate(cf_jobs_total{status="completed"}[7d]))
/
sum(rate(cf_jobs_total[7d]))
```

**Error budget burn example:** at 10 000 jobs/week the budget is 100 failed jobs.
`JobFailureSpike` (5 failures in 15 m) will fire well before the weekly budget is exhausted,
giving time to investigate before the SLO is at risk.

---

## Error Budget Policy

1. **> 50 % budget remaining** — normal operations; no action required.
2. **25 – 50 % remaining** — engineering review; root-cause open issues this sprint.
3. **< 25 % remaining** — freeze risky deploys; on-call escalation required.
4. **Budget exhausted** — incident declared; post-mortem required within 3 business days.

---

## Revision History

| Date | Change |
|------|--------|
| 2026-07-11 | Initial SLOs — Phase 5 Wave 5 |
