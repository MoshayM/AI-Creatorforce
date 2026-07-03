# database.md — AI CreatorForce

## 1. Conventions

- **Engine:** PostgreSQL (+ **pgvector** extension for semantic memory). **ORM:** Prisma (migrations source of truth).
- **IDs:** `cuid()`/`uuid` primary keys, prefixed externally (`prj_`, `job_`, `rnd_`) for readability.
- **Timestamps:** `createdAt`, `updatedAt` (UTC) on every table.
- **Soft deletes:** `deletedAt` nullable where retention matters (projects, assets, audit).
- **Flexible payloads:** agent outputs / bundles stored as `JSONB` with a `schemaVersion`, but always validated by Zod in the app layer before write.
- **Provenance:** every generated asset version stores provider, model, prompt version, params — **write-once**.
- **Tenancy:** all rows scoped by `userId` (and `teamId` where teams apply); enforced in queries + row-level checks.

## 2. Entity Overview

```
User ─┬─< Channel ─< Project ─┬─< Script
      │                       ├─< ResearchPack
      │                       ├─< FactcheckResult (via Script)
      │                       ├─< ComplianceReport
      │                       ├─< Asset ─< AssetVersion
      │                       ├─< Timeline (versioned)
      │                       ├─< Render
      │                       ├─< MetadataDraft
      │                       ├─< PublishRecord
      │                       └─< Job
      ├─< Subscription
      ├─< UsageRecord
      ├─< TeamMembership >─ Team
      └─< AuditLog
Channel ─< AnalyticsSnapshot · Channel ─< MemoryEmbedding
PromptVersion (global)
```

## 3. Core Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| email | text unique | |
| name | text | |
| role | enum(owner,admin,member) | platform role |
| planTier | enum(free,creator,pro,agency) | |
| stripeCustomerId | text null | |
| createdAt / updatedAt | timestamptz | |

### teams / team_memberships (Beta+)
- `teams(id, name, ownerId, planTier)`
- `team_memberships(id, teamId, userId, role enum(owner,admin,editor,reviewer,viewer))`

### channels
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK | |
| teamId | uuid FK null | |
| ytChannelId | text | YouTube channel ID |
| title | text | |
| oauthTokenRef | text | reference to encrypted token (not the token) |
| scopes | text[] | granted OAuth scopes |
| niche | text | |
| voiceProfile | jsonb | tone/style + consented TTS voice refs |
| brandKit | jsonb | colors/fonts/thumbnail style/overlay templates |
| status | enum(connected,revoked,error) | |

> OAuth tokens are stored encrypted in a dedicated secrets store; `oauthTokenRef` points to it. See `security.md`.

### projects (ContentProject)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| channelId | uuid FK | |
| userId | uuid FK | |
| title | text | working title |
| topic | jsonb | selected topic + scores |
| format | enum(long,shorts) | |
| state | enum(draft,research,scripted,factchecked,compliance,assets,editing,rendered,metadata,review,scheduled,published,archived) | pipeline state |
| compliancePassed | boolean | gate flag |
| humanApproved | boolean | gate flag |
| bundle | jsonb | assembled content bundle (schemaVersion'd, incl. pinned finalRenderId) |
| bundleHash | text | hash of the reviewed bundle (WF-5/WF-7) |
| deletedAt | timestamptz null | |

### scripts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| version | int | increments on edit |
| format | enum(long,shorts) | |
| sections | jsonb | Hook/Problem/Story/Evidence/Solution/CTA w/ timestamps + cues + per-section contentHash |
| claims | jsonb | claims w/ source refs + per-claim textHash |
| contentHash | text | whole-script hash for idempotency / re-review |

### research_packs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| sources | jsonb | [{title,url,publisher,date,summary}] paraphrased |
| claimMap | jsonb | claim → supporting source refs |

### factcheck_results
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| scriptId | uuid FK | |
| verdicts | jsonb | per-claim {verdict,confidence,evidenceRef} |
| passed | boolean | gate result |

### compliance_reports
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| complianceScore | int | 0–100 |
| monetizationRisk | enum(low,medium,high) | |
| copyrightRisk | enum(low,medium,high) | |
| advertiserFriendly | boolean | |
| flags | jsonb | [{code,severity,location,reason}] |
| recommendation | enum(pass,revise,block) | |
| ruleSetVersion | text | active compliance rule set (admin.md §3.6) |
| reviewedBundleHash | text | which bundle was reviewed |

## 4. Media Tables

### assets
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| kind | enum(music,video,thumbnail,voice,image,subtitle,render_source,upload) | extended for media pipeline |
| currentVersionId | uuid FK → asset_versions | active version |
| status | enum(briefed,generating,ready,failed,accepted) | of current version |
| label | text | e.g. "Section 2 VO", "Scene 4 still" |
| deletedAt | timestamptz null | soft |

### asset_versions  *(new)*
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| assetId | uuid FK | |
| version | int | append-only |
| r2Key | text | object key (content-hash dedup upstream) |
| contentHash | text | dedupe + idempotency |
| provider / model | text | |
| prompt | jsonb | brief/spec used |
| params | jsonb | generation params |
| provenance | jsonb | write-once: timestamps, ToS notes, license, consent refs |
| sizeBytes | bigint | |
| durationMs | int null | audio/video |
| wordTimestamps | jsonb null | voice takes (subtitle alignment) |

### timelines  *(new — `video-editor.md`)*
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| version | int | frozen versions; working draft = latest+pending |
| label | text null | "AI first cut", creator labels |
| fps / resolution | int / jsonb | |
| tracks | jsonb | schemaVersion'd Timeline JSON; clips pin assetVersionIds |
| contentHash | text | render idempotency |
| isDraft | boolean | working draft flag (optimistic-locked) |

### renders  *(new — `media-pipeline.md` §8)*
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| timelineId | uuid FK | |
| timelineVersion | int | |
| preset | enum(draft_proxy,yt_1080p,yt_4k,shorts_1080x1920) | |
| status | enum(queued,rendering,ready,failed) | |
| progressPct | int | |
| r2Key | text null | |
| sizeBytes / durationMs | bigint / int | |
| checksum | text | |
| costCredits | numeric | settled render credits |
| error | jsonb null | |
| UNIQUE(projectId, timelineVersion, preset) | | idempotency |

### metadata_drafts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| title | text | |
| description | text | includes chapters |
| tags / hashtags | text[] | |
| category / language | text | |
| disclosures | jsonb | AI/altered-content flags (fed by media pipeline synthetic flags) |
| seoScore | int | |

### publish_records
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| renderId | uuid FK | the exact render published |
| ytVideoId | text null | |
| status | enum(scheduled,publishing,published,failed) | |
| scheduledAt / publishedAt | timestamptz null | |
| receipt | jsonb | API response summary |
| error | jsonb null | |

## 5. Ops, AI & Billing Tables

### jobs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK null | |
| queue | text | research/content/compliance/assets-voice/assets-image/assets-music/assets-video/assets-thumbnail/subtitles/render/publish/analytics |
| step | text | |
| status | enum(queued,running,succeeded,failed,canceled) | |
| attempts | int | |
| correlationId | text | |
| input / result | jsonb | |
| costUsd | numeric | metered (settled) |
| reservedCostUsd | numeric | budget reservation (released on failure) |
| error | jsonb null | |

### analytics_snapshots
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| channelId | uuid FK | |
| ytVideoId | text null | null = channel-level |
| capturedAt | timestamptz | |
| metrics | jsonb | ctr, retentionCurve, watchTime, revenue, subs, impressions |

### memory_embeddings  *(new — `token-optimization.md` §7)*
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| channelId | uuid FK | tenant-scoped |
| kind | enum(topic,hook_pattern,retention_finding,style_note) | |
| text | text | distilled statement (≤ 2 sentences) |
| embedding | vector | pgvector; HNSW index |
| sourceRef | jsonb | provenance (report/video) |

### subscriptions / usage_records (billing)
- `subscriptions(id, userId, stripeSubId, planTier, status, currentPeriodEnd)`
- `usage_records(id, userId, period, tokensUsed, voiceSeconds, imageCount, videoCredits, musicCredits, renderMinutes, costUsd)`

### prompt_versions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| key | text | e.g. `script.longform`, `edit.firstcut` |
| version | int | |
| body | text | template |
| active | boolean | |

### audit_logs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK null | null = system; admin actions carry internal actor id |
| action | text | publish/edit/compliance_decision/connect_channel/render/admin_*/… |
| target | text | entity reference |
| meta | jsonb | incl. reason for admin actions |
| createdAt | timestamptz | append-only |

## 6. Key Indexes

- `projects(channelId, state)`, `projects(userId, updatedAt)`
- `jobs(queue, status)`, `jobs(projectId)`, `jobs(correlationId)`
- `assets(projectId, kind, status)`, `asset_versions(assetId, version)`, `asset_versions(contentHash)`
- `timelines(projectId, version)`, `renders(projectId, timelineVersion, preset)` unique
- `analytics_snapshots(channelId, ytVideoId, capturedAt)`
- `compliance_reports(projectId, createdAt)`
- `memory_embeddings` HNSW on `embedding`, btree `(channelId, kind)`
- Unique: `users(email)`, `channels(userId, ytChannelId)`, `prompt_versions(key, version)`

## 7. Integrity & Safety Rules

- A `publish_record` cannot be created unless the linked project has `compliancePassed = true` AND `humanApproved = true` AND `bundleHash` matches the reviewed hash; it must reference a `ready` render (enforced in service layer + re-checked by `PublishingAgent`).
- Editing a `script`, `metadata_draft`, or subtitle **text** after approval resets `compliancePassed` and `humanApproved` (WF-7a). Timeline/arrangement edits and new renders reset `humanApproved` only (WF-7b).
- `assets` cannot move to `generating`, timelines cannot render, for any project whose latest `compliance_report.recommendation ≠ pass`.
- `asset_versions.provenance` is write-once (trigger-protected); asset versions referenced by any frozen timeline version cannot be hard-deleted.
- Budget reservation (`jobs.reservedCostUsd`) must be released or settled — a reaper job closes orphans.
- Cascade deletes are soft where audit/billing history must persist; `memory_embeddings` never cross channels.

## 8. Migrations

Prisma migrations are the source of truth, versioned in `infra/db/migrations`. No manual schema edits in any environment; all changes flow through reviewed migrations in CI. Seed data lives in `infra/db/seed.ts`. pgvector extension enabled via migration.
