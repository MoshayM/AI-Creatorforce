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

Node.js process and event-loop metrics are also exported with the `cf_` prefix
via `collectDefaultMetrics`.

## Building a Grafana dashboard

Grafana is pre-provisioned with a Prometheus datasource pointed at
`http://prometheus:9090`. Log in and use **Explore** or **+ New Dashboard** to
start querying the `cf_*` metrics listed above.
