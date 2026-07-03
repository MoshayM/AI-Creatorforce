# analytics.md — AI CreatorForce

> How AI CreatorForce measures channel/video performance and converts it into the next video's plan. Powered by the Analytics Intelligence Engine (`AnalyticsAgent` + `GrowthAgent`) over data from the YouTube Analytics API.

## 1. Data Sources

- **YouTube Analytics API** (per connected channel/video): CTR, impressions, retention curve, average view duration, watch time, revenue/RPM, subscribers gained/lost, traffic sources.
- **Platform-internal:** which agents/topics produced each video, compliance outcomes, generation cost.
- Polling jobs (WF-6) snapshot metrics into `analytics_snapshots` on a schedule; recency increases right after publish, then tapers.

## 2. Metrics Tracked

| Category | Metrics |
|----------|---------|
| Discovery | Impressions, CTR, traffic sources |
| Retention | Retention curve, avg view duration, % watched, drop-off points |
| Engagement | Likes, comments, shares, subscribers gained |
| Watch time | Total watch time, trend over time |
| Revenue | Estimated revenue, RPM, monetized playbacks |
| Growth | Subscriber net change, source of subs |

## 3. AnalyticsAgent — Diagnosis

Input: metric snapshots for a video/channel. Output: a **growth report** that interprets, not just displays:

- **CTR analysis:** is the title/thumbnail earning clicks? Compare to channel baseline.
- **Retention analysis:** where do viewers drop off? Map drop-offs to script sections (hook weak? mid-roll lull?).
- **Watch-time analysis:** trend and contribution to channel watch time.
- **Revenue analysis:** RPM trends, monetization health.
- **Subscriber analysis:** which videos convert viewers to subscribers.

Each finding is tied to a specific metric and an actionable cause hypothesis.

## 4. GrowthAgent — Action & Next Steps

Input: growth report + channel goals. Output:
- **Optimization suggestions:** concrete changes (e.g., stronger hook in first 15s, tighten mid-section, test new thumbnail, adjust title pattern).
- **Next-video recommendations:** topic seeds derived from what performed, feeding back into `TrendAgent` (WF-6 → WF-1).
- **Prioritization:** ranked by expected impact vs effort.

## 5. Feedback Loop

```
Published video → metrics snapshots → AnalyticsAgent (diagnose)
   → GrowthAgent (recommend) → next topics seed TrendAgent
   → new project → … → improved next video
```

Over time, the platform learns which patterns work for a specific channel (stored in the channel's profile/voice data) and biases recommendations accordingly — without manufacturing fake engagement.

## 6. Dashboards (creator-facing)

- **Channel overview:** KPI cards (CTR, watch time, subs, revenue) with trend lines (Recharts).
- **Video detail:** retention curve overlaid on script sections; CTR vs baseline; revenue.
- **Recommendations panel:** prioritized actions + suggested next topics.
- **A/B thumbnail results:** CTR by variant.

## 7. Honest Analytics Principles

- Never recommend deceptive tactics (clickbait that misrepresents, engagement manipulation, fake interactions).
- Recommendations aim at genuine improvements to content quality and discoverability.
- Retention advice focuses on making the content actually better/clearer, not on tricking the algorithm.

## 8. Internal Platform Analytics (ops)

Separate from creator analytics, the platform tracks operational metrics (Prometheus/Grafana): job latency, queue depth, agent cost per video, compliance pass rates, provider error rates, budget burn. Used for reliability and unit economics, not exposed to creators.

## 9. Data Retention & Privacy

- Analytics snapshots retained per plan/retention policy; creator can export/delete.
- Analytics data is the creator's; scoped per channel; never cross-tenant. See `security.md`.

## 10. Invariants for Code Agents

1. Analytics recommendations must never suggest policy-violating or deceptive tactics.
2. Snapshots are scoped to the owning channel/tenant.
3. Diagnosis must reference the specific metric it's based on (no unsupported claims).
4. The growth loop feeds TrendAgent; keep that contract stable.
