# analytics.md — AI CreatorForce

The Analytics Intelligence Engine measures channel and video performance by pulling data from YouTube APIs and internal usage logs, storing it in `AnalyticsSnapshot` rows, and converting it into actionable growth recommendations that seed the next video's plan. See `features.md` for the broader feature map and `database.md` for schema details.

---

## 1. Data Sources

### 1.1 YouTube Data API

Video statistics (viewCount, likeCount, commentCount) fetched via `youtube.videos.list`. Called by `PublishingService.getVideoStats()` for post-publish polling. The `Video` model stores snapshot values of these counters (updated by analytics jobs, not authoritative for real-time reads).

### 1.2 YouTube Analytics API

Channel-level and video-level analytics: views, watch time, CTR, audience retention curves, traffic sources, demographics. Polled by `AnalyticsAgent` on ANALYTICS job execution.

### 1.3 Internal Usage Logs

`UsageLog` model tracks platform resource consumption per user per operation:

| Resource type | Meaning |
|---------------|---------|
| AI_TOKENS | LLM token consumption |
| VIDEO_GENERATED | Asset generation job completed |
| VIDEO_PUBLISHED | Video successfully published to YouTube |
| RESEARCH_QUERY | ResearchAgent query executed |
| COMPLIANCE_CHECK | ComplianceAgent evaluation run |
| VOICE_SECONDS | Voice synthesis seconds consumed |
| IMAGE_GENERATED | Image generation job completed |
| MUSIC_GENERATED | Music generation job completed |
| VIDEO_CLIP_GENERATED | Video clip generation job completed |
| RENDER_MINUTES | Rendering pipeline minutes consumed |

These records feed internal unit economics dashboards (see Section 6) and are not exposed to creators directly.

---

## 2. Storage

`AnalyticsSnapshot` model:

- `channelId` — owning channel (required)
- `ytVideoId` — nullable; null indicates a channel-level snapshot
- `capturedAt` — timestamp of the snapshot
- `metrics` — JSON blob containing raw metric values

Index on `[channelId, ytVideoId, capturedAt]` supports range queries by channel, per video, in time order. The JSON `metrics` field allows forward-compatible schema evolution: new metric keys can be added without a migration.

---

## 3. Agents

### 3.1 AnalyticsAgent

Location: `packages/agents/src/analytics.agent.ts`

Triggered by the ANALYTICS job type. Pulls YouTube analytics for the configured channel and time window, processes the raw data, and writes `AnalyticsSnapshot` rows. Operates stateless and idempotent — safe to re-run for a time window.

### 3.2 GrowthAgent

Location: `packages/agents/src/growth.agent.ts`

Triggered by the GROWTH_REPORT job type. Reads `AnalyticsSnapshot` rows for a channel, identifies top- and bottom-performing content patterns, and outputs prioritized topic and optimization recommendations. Output feeds back into `TrendAgent` to seed the next video's research phase.

### 3.3 AudienceAgent

Location: `packages/agents/src/audience.agent.ts`

Triggered by the AUDIENCE_ANALYSIS job type. Analyzes audience demographics and behavioral patterns from YouTube Analytics API data. Output informs content targeting recommendations.

---

## 4. API Surface

| Endpoint | Description |
|----------|-------------|
| `GET /analytics?channelId=&from=&to=` | Returns `AnalyticsSnapshot` rows and aggregates for the specified channel and date range |
| `GET /bi` | Business intelligence aggregates (bi module): platform-wide or per-user usage metrics for the ops team |
| `GET /growth/report` | Current `GrowthAgent` output for the authenticated user's active channel |

---

## 5. Metrics Flow

```
Post-publish (or scheduled trigger)
  → ANALYTICS job enqueued → SupervisorWorker picks up
  → AnalyticsAgent: pulls YouTube Analytics API → writes AnalyticsSnapshot rows
  → GROWTH_REPORT job enqueued
  → GrowthAgent: reads snapshots → produces growth insight
  → Insight surfaced to creator in UI
  → Top-performing topic patterns fed back to TrendAgent for next video plan
```

---

## 6. Internal Platform Observability

Separate from creator-facing analytics, the platform collects operational metrics for the ops team:

- `MetricsInterceptor` on every API route records `http_request_duration_ms` histogram via `prom-client`.
- `GET /metrics` on the API exposes Prometheus-format metrics for scraping.
- Grafana dashboards at `infra/monitoring/grafana/` cover queue depth, agent cost per video, compliance pass rates, provider error rates, job latency, and budget burn.
- Alert definitions at `infra/monitoring/alerts.yml`.

These metrics are not accessible to creators.

---

## 7. Honest Analytics Principles

- Recommendations must never suggest policy-violating or deceptive tactics.
- Retention and CTR advice targets genuine content quality improvements, not algorithm manipulation.
- Diagnosis must reference the specific metric it is based on — no unsupported causal claims.
- Snapshots are strictly scoped to the owning channel and tenant (no cross-tenant reads). See `security.md`.

---

## 8. Planned / Not Yet Implemented

- Scheduled analytics polling (currently triggered manually or post-publish only)
- YouTube Analytics API deep pull for retention curves and watch-time breakdowns
- Comparative benchmarking against niche channel averages
- Notification-triggered analytics refresh on significant metric changes
- Creator-facing retention curve visualization overlaid on script sections
