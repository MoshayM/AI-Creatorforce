# CreatorForce — Disaster Recovery Runbooks

> **RTO: 1 hour | RPO: 24 hours** (daily `backup.sh` runs).
>
> To improve RPO to minutes, enable PostgreSQL WAL archiving (continuous archiving / PITR).
> This requires configuring `archive_mode = on`, `archive_command`, and a standby server
> with `restore_command`. See the [PostgreSQL PITR docs](https://www.postgresql.org/docs/current/continuous-archiving.html).
> Until WAL archiving is enabled, the worst-case data loss is the interval between backups.

---

## Table of Contents

- [api-down](#api-down)
- [high-error-rate](#high-error-rate)
- [job-failures](#job-failures)
- [ai-cost-spike](#ai-cost-spike)
- [database-restore](#database-restore)
- [redis-loss](#redis-loss)
- [provider-outage](#provider-outage)

---

## api-down

**Alert:** `ApiDown` (critical) — Prometheus has not been able to scrape `host.docker.internal:4007/metrics` for > 2 minutes.

### Diagnosis

1. Check whether the API process is running:
   ```bash
   # On the server / in the deployment environment
   systemctl status creatorforce-api
   # or, if using Docker Compose:
   docker compose ps
   ```
2. Check recent API logs:
   ```bash
   docker compose logs --tail=100 api
   # or: journalctl -u creatorforce-api -n 100 --no-pager
   ```
3. Try a direct health-check:
   ```bash
   curl -f http://localhost:4007/health
   ```
4. Verify database connectivity (a DB connection failure will cause startup to hang/crash):
   ```bash
   psql "${DATABASE_URL}" -c "SELECT 1;"
   ```
5. Verify Redis connectivity:
   ```bash
   redis-cli -u "${REDIS_URL}" ping
   ```

### Recovery

- **Process crashed:** restart via `systemctl restart creatorforce-api` or `docker compose up -d api`.
- **Database unavailable:** follow [database-restore](#database-restore) or restore the DB connection string and restart.
- **Redis unavailable:** follow [redis-loss](#redis-loss) — the API can restart without Redis for non-queue paths, but BullMQ jobs will fail.
- **Out of memory / disk:** free resources, rotate logs, then restart.

### Escalation

If the API does not recover within 30 minutes, escalate to the on-call engineer and declare an incident.

---

## high-error-rate

**Alerts:** `HighErrorRateWarning` (> 5 % 5xx for 5 m) and `HighErrorRateCritical` (> 20 % 5xx for 5 m).

### Diagnosis

1. Check Grafana → **CreatorForce Overview** dashboard → **Error Rate %** panel for which routes are failing.
2. Check API logs for stack traces:
   ```bash
   docker compose logs --tail=200 api | grep -i "error\|exception\|500"
   ```
3. Check Sentry for grouped errors (SENTRY_DSN in `.env`).
4. Check if the error rate correlates with a recent deploy (`git log --oneline -10`).
5. Check database query performance — a slow query can cause timeouts that manifest as 5xx.

### Recovery

- **Bad deploy:** roll back to the previous image/commit.
- **Overloaded dependency (DB/Redis/AI provider):** see [provider-outage](#provider-outage) or [redis-loss](#redis-loss).
- **Misconfiguration:** fix the env var or config and restart.

---

## job-failures

**Alert:** `JobFailureSpike` (warning) — more than 5 BullMQ job failures in 15 minutes.

### Diagnosis

1. Check Grafana → **Jobs completed/failed** panel for which job types are failing.
2. Inspect BullMQ dead-letter queues via the Bull Board UI (if enabled) or via Redis CLI:
   ```bash
   redis-cli -u "${REDIS_URL}" LLEN "bull:<queue-name>:failed"
   ```
3. Check API logs for the failing worker:
   ```bash
   docker compose logs --tail=200 api | grep -i "job.*fail\|BullMQ"
   ```
4. Determine if failures are AI provider errors (transient) or application bugs (persistent).

### Recovery

- **AI provider transient errors:** the shared `aiClient` will already retry and fail-over; monitor for recovery.
- **Persistent failures:** fix the underlying bug, redeploy, then retry failed jobs from Bull Board or via:
  ```bash
  # Retry all failed jobs in a queue (BullMQ CLI or custom script)
  # See apps/api/src/modules/queue/ for queue names.
  ```
- **Queue backlog:** if jobs are piling up, scale out worker replicas.

---

## ai-cost-spike

**Alerts:** `AiCostSpike` (warning) — AI spend > $10 in 1 hour. `CacheHitStall` (info) — no cache hits while tokens are flowing.

### AiCostSpike — Diagnosis

1. Check Grafana → **AI Cost USD/hour** and **AI tokens by provider** panels.
2. Identify the provider/model driving the spike (label `provider`, `model` on `cf_ai_cost_usd_total`).
3. Check for rogue or stuck retry loops in job logs.
4. Check if a cache regression is causing re-computation (see `CacheHitStall` below).
5. Check the Profit Protection Engine admin endpoint:
   ```
   GET /v1/admin/profit/preview
   ```
   to confirm margin is still positive.

### AiCostSpike — Recovery

- **Rogue job:** identify and kill it via Bull Board or `redis-cli DEL bull:<queue>:<job-id>`.
- **Provider pricing change:** update `provider_cost_rates` via the admin API and re-evaluate `pricing_rules`.
- **Budget guard:** if cost exceeds safe limits, disable the provider temporarily:
  ```
  PATCH /v1/admin/providers/:id  { "status": "disabled" }
  ```

### CacheHitStall — Diagnosis

1. Check Grafana → **Cache hits by kind** panel.
2. Verify cache keys are being generated consistently (prompt normalisation, model param hashing).
3. Check Redis memory and eviction policy:
   ```bash
   redis-cli -u "${REDIS_URL}" INFO memory
   redis-cli -u "${REDIS_URL}" CONFIG GET maxmemory-policy
   ```
4. Check for a recent deploy that changed prompt templates (key drift).

### CacheHitStall — Recovery

- **Eviction policy too aggressive:** set `maxmemory-policy allkeys-lru` (or `volatile-lru`) and increase `maxmemory`.
- **Key drift from prompt change:** this is expected on a template upgrade; the cache warms up over the next few hours.
- **Cache service down:** follow [redis-loss](#redis-loss).

---

## database-restore

**Scenario:** data corruption, accidental deletion, or unrecoverable primary failure.

> **Read this entire section before running any command.**
> The restore drops and recreates the target database.

### Pre-restore checklist

- [ ] Confirm which backup to restore from (`ls -lh $BACKUP_DIR`).
- [ ] Confirm the target database is not the live production DB (use a separate `TARGET_DATABASE_URL`).
- [ ] Notify stakeholders of the maintenance window.
- [ ] Record the current ledger row count for post-restore verification:
  ```sql
  SELECT count(*) AS ledger_rows FROM credit_ledger;
  SELECT count(*) AS audit_rows  FROM audit_logs;
  ```

### Step 1 — Stop the API

```bash
systemctl stop creatorforce-api
# or: docker compose stop api
```

### Step 2 — Restore the dump

```bash
export TARGET_DATABASE_URL="postgresql://user:pass@host:5432/creatorforce_restored"
./infra/dr/restore.sh \
  --dump-file /var/backups/creatorforce/creatorforce_2026-07-10_020001.dump \
  --i-understand
```

### Step 3 — Verify migrations

```bash
cd apps/api
npx prisma migrate status
```

All migrations should report `Applied`. If any are pending, run `npx prisma migrate deploy`.

### Step 4 — Smoke test

Point `DATABASE_URL` at the restored database, start the API in a non-production mode, and run:

```bash
curl -f http://localhost:4007/health
```

### Step 5 — Ledger spot-check

Connect to the restored database and compare row counts to the pre-restore baseline:

```sql
SELECT count(*) AS ledger_rows FROM credit_ledger;
SELECT count(*) AS audit_rows  FROM audit_logs;
-- Compare to values recorded in Pre-restore checklist above.
-- Any ledger rows after the backup timestamp will be missing (this is the RPO gap).
```

### Step 6 — Boot and monitor

```bash
# Update DATABASE_URL to point at the restored DB, then:
systemctl start creatorforce-api
# or: docker compose up -d api
```

Monitor Grafana for error-rate normalisation. Watch `ApiDown` alert to clear.

### Step 7 — Post-incident

- Document the incident timeline in a post-mortem.
- Consider enabling WAL archiving / PITR to reduce future RPO.
- Validate backup cadence and retention policy.

---

## redis-loss

**Scenario:** Redis instance is unresponsive, corrupted, or was wiped.

### What is lost

| Data | Impact |
|------|--------|
| **BullMQ queue state** | All pending, active, delayed, and failed jobs are lost. In-flight AI generation jobs that were running will not complete. |
| **Intent / AI response cache** | Cache miss on next request — providers will be called again. Costs slightly more until the cache warms up. |
| **Embedding cache** | Same as above — embeddings will be recomputed on demand. |
| **Session tokens (if stored in Redis)** | Users will need to log in again. JWTs are stateless, so API keys still work. |
| **Rate-limit counters** | Momentary burst allowed until counters rebuild. |

### What is NOT lost

- All financial ledger data (in PostgreSQL — append-only, crash-safe).
- All user data, content, channel records (in PostgreSQL).
- Audit logs (in PostgreSQL).

### Recovery order

1. **Restore or restart Redis.** The simplest recovery is restarting the Redis service/container with a fresh instance:
   ```bash
   docker compose restart redis
   # or provision a new Redis instance and update REDIS_URL
   ```
2. **Restart the API.** BullMQ will reconnect and begin accepting new jobs:
   ```bash
   systemctl restart creatorforce-api
   ```
3. **Re-queue incomplete jobs.** Any AI generation jobs that were in-flight need to be re-submitted by the user or via an admin re-trigger endpoint. Check the last `credit_ledger` entries for `status="reserved"` records with no corresponding `settled` entry — these are stale holds that should be released or retried.
4. **Monitor cache warm-up.** Watch Grafana → **Cache hits by kind**. Expect zero hits for the first few minutes; hits should resume as the cache fills.

---

## provider-outage

**Scenario:** one or more AI providers (Anthropic, OpenAI, Gemini, etc.) become unavailable or degraded.

### The shared client already handles this

The `aiClient` (`packages/agents/`) wraps all provider calls with:
- **Automatic retry** (exponential backoff, configurable `MAX_AGENT_RETRIES`).
- **Provider failover** — if a provider is marked `down` or `degraded` in `ai_providers`, the Smart Routing Engine automatically routes to the next-priority provider serving the same task type.

### Verifying a provider outage via /metrics

```bash
curl http://localhost:4007/metrics | grep cf_ai_tokens_total
# Look for a provider whose token counter has stopped incrementing.

curl http://localhost:4007/metrics | grep cf_ai_cost_usd_total
# Similarly — a dead provider will show no new cost increments.
```

In Grafana: **AI tokens by provider** panel shows per-provider token rates in real time.

### Manually disabling a provider

If automatic failover has not triggered (e.g., the provider is responding slowly rather than hard-failing), disable it via the admin API:

```bash
curl -X PATCH https://your-api/v1/admin/providers/:id \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status": "disabled"}'
```

Replace `:id` with the provider's UUID from `GET /v1/admin/providers`.

### Re-enabling a provider

Once the provider's status page reports recovery, re-enable and let the health-check job verify:

```bash
curl -X PATCH https://your-api/v1/admin/providers/:id \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

### If all providers fail simultaneously

This is an extreme scenario. Options:
1. Enable `ALLOW_OFFLINE_MEDIA=true` temporarily to serve placeholder responses and prevent hard failures (see `.env.example`).
2. Communicate a service degradation banner to users.
3. Re-enable providers one by one as they recover, verifying via `/metrics`.

---

*Last updated: 2026-07-11 | Phase 5 Wave 5*
