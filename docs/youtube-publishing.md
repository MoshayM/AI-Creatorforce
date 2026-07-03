# youtube-publishing.md — AI CreatorForce

> How AI CreatorForce connects to YouTube and publishes content via the **YouTube Data API**, with hard gates ensuring nothing ships without compliance pass + human approval.

> **Policy/quota note:** YouTube Data API quotas, scopes, upload limits, and disclosure requirements change. Verify current YouTube Data API documentation and YouTube policies (as of build time) before implementing. The values and behaviors below reflect best practices as of June 2026.

## 1. Connection (OAuth)

1. Creator clicks "Connect YouTube" → Google OAuth consent.
2. Request **minimum scopes**: upload/manage own videos and read analytics for the connected channel. No broader access.
3. Store access + refresh tokens **encrypted** (see `security.md` §5); DB holds only `oauthTokenRef`.
4. On revoke/disconnect: call Google's revoke endpoint and delete/rotate stored tokens.

## 2. Publish Preconditions (hard gate)

A publish job **must verify** before any API call:

```
compliancePassed == true        // latest compliance report = pass
AND humanApproved == true        // explicit creator approval
AND bundleHash matches reviewed  // no post-approval edits (else WF-7)
```

If any fails → refuse with `409 COMPLIANCE_BLOCKED` / `409 APPROVAL_REQUIRED`. **No override path exists.** (`PublishingAgent` re-checks even if the API layer already did.)

## 3. Publish Flow

```
1. MetadataAgent finalizes: title, description (+chapters), tags, hashtags,
   category, language, AI/synthetic-media disclosure flags.
2. PublishingAgent (queued job, idempotent via Idempotency-Key):
   a. Refresh OAuth token if needed (in-memory only).
   b. Insert video (resumable upload of the rendered video asset from R2).
   c. Set snippet (title/desc/tags/category/language).
   d. Set status (privacy: public/unlisted/private or scheduled publishAt).
   e. Apply self-certification / disclosure settings per current API support.
   f. Upload + set custom thumbnail.
3. Record PublishRecord (ytVideoId, status, receipt).
4. Register analytics polling job.
```

### Idempotency & retries
- Jobs carry a dedupe key `(projectId, "publish")`. Re-running a succeeded publish is a no-op.
- Resumable uploads handle interruptions; partial uploads resume rather than duplicate.
- Transient API errors → exponential backoff retry; permanent errors → mark `failed`, surface reason, do not silently retry forever.

## 4. Scheduling

- Creator may schedule via `publishAt` (future). The video is uploaded as `private` with a scheduled publish time, per Data API behavior.
- Scheduled items still required to have passed compliance + human approval **before** scheduling.
- WF-7: editing a scheduled item resets gates and pauses the schedule until re-approved.

## 5. Disclosures

- AI-generated / significantly altered / synthetic media disclosures applied based on the `ComplianceAgent` assessment and stored `disclosures` flags.
- The platform never publishes synthetic-as-authentic content where disclosure is required. See `compliance.md` §3.4.

## 6. Quota & Rate Management

- Upload and write operations are quota-expensive; the platform:
  - Batches and schedules to respect daily quota.
  - Caches read operations (channel info, analytics) in Redis.
  - Surfaces quota-related delays to the creator rather than failing opaquely.
- Per-channel and per-plan publish rate limits prevent spammy bursts.

## 7. Thumbnails

- Custom thumbnail uploaded via the thumbnails endpoint after the video resource exists.
- Must meet YouTube's size/format requirements (verify current specs).
- A/B selection: the chosen variant is published; alternates retained in the asset library.

## 8. Error Handling & Receipts

| Situation | Behavior |
|-----------|----------|
| Token expired | Refresh in-memory; if refresh fails → mark channel `error`, notify creator to reconnect |
| Quota exceeded | Defer + reschedule job; notify creator |
| Upload interrupted | Resume via resumable upload |
| Policy rejection from YouTube | Record reason, surface to creator, do not retry blindly |
| Success | Store `ytVideoId`, status, publishedAt, receipt summary |

## 9. Analytics Hook

After publish, register a polling job (WF-6) to pull YouTube Analytics (CTR, retention, watch time, revenue, subscribers) into `analytics_snapshots`, feeding the AnalyticsAgent/GrowthAgent loop.

## 10. Invariants for Code Agents

1. Never call the YouTube write API without passing the precondition gate.
2. Never store YouTube OAuth tokens in plaintext or primary DB.
3. Always make publish jobs idempotent.
4. Always apply required disclosures.
5. Always record a PublishRecord (success or failure) for auditability.
6. Re-verify gates inside `PublishingAgent`, not just at the API layer.
