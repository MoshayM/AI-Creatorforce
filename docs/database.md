# database.md — AI CreatorForce

## 1. Conventions

- **Engine:** PostgreSQL. **ORM:** Prisma (migrations source of truth).
- **IDs:** `cuid()`/`uuid` primary keys, prefixed externally (`prj_`, `job_`) for readability.
- **Timestamps:** `createdAt`, `updatedAt` (UTC) on every table.
- **Soft deletes:** `deletedAt` nullable where retention matters (projects, assets, audit).
- **Flexible payloads:** agent outputs / bundles stored as `JSONB` with a `schemaVersion`, but always validated by Zod in the app layer before write.
- **Provenance:** every generated asset stores provider, model, prompt version, params.
- **Tenancy:** all rows scoped by `userId` (and `teamId` where teams apply); enforced in queries + row-level checks.

## 2. Entity Overview

```
User ─┬─< Channel ─< Project ─┬─< Script
      │                       ├─< ComplianceReport
      │                       ├─< Asset (music|video|thumbnail)
      │                       ├─< MetadataDraft
      │                       ├─< PublishRecord
      │                       └─< Job
      ├─< Subscription
      ├─< UsageRecord
      ├─< TeamMembership >─ Team
      └─< AuditLog
ResearchPack >─ Project
AnalyticsSnapshot >─ Channel / Video
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
| voiceProfile | jsonb | tone/style |
| brandKit | jsonb | colors/fonts/thumbnail style |
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
| state | enum(draft,research,scripted,factchecked,compliance,assets,metadata,review,scheduled,published,archived) | pipeline state |
| compliancePassed | boolean | gate flag |
| humanApproved | boolean | gate flag |
| bundle | jsonb | assembled content bundle (schemaVersion'd) |
| deletedAt | timestamptz null | |

### scripts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| version | int | increments on edit |
| format | enum(long,shorts) | |
| sections | jsonb | Hook/Problem/Story/Evidence/Solution/CTA w/ timestamps + cues |
| claims | jsonb | claims w/ source refs |
| contentHash | text | for idempotency / re-review |

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
| reviewedBundleHash | text | which bundle was reviewed |

### assets
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| kind | enum(music,video,thumbnail) | |
| r2Key | text | object key in R2 |
| status | enum(briefed,generating,ready,failed,accepted) | |
| provider | text | suno/udio/veo/kling/runway/pika/luma/etc |
| model | text | |
| prompt | jsonb | brief/prompt used |
| params | jsonb | generation params |
| provenance | jsonb | timestamps, ToS notes, license info |
| ctrPrediction | numeric null | thumbnails |

### metadata_drafts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| title | text | |
| description | text | includes chapters |
| tags | text[] | |
| hashtags | text[] | |
| category | text | |
| language | text | |
| disclosures | jsonb | AI/altered-content flags |
| seoScore | int | |

### publish_records
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK | |
| ytVideoId | text null | |
| status | enum(scheduled,publishing,published,failed) | |
| scheduledAt | timestamptz null | |
| publishedAt | timestamptz null | |
| receipt | jsonb | API response summary |
| error | jsonb null | |

### jobs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| projectId | uuid FK null | |
| queue | text | research/content/compliance/assets-*/publish/analytics |
| step | text | |
| status | enum(queued,running,succeeded,failed,canceled) | |
| attempts | int | |
| correlationId | text | |
| input | jsonb | |
| result | jsonb null | |
| costUsd | numeric | metered |
| error | jsonb null | |

### analytics_snapshots
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| channelId | uuid FK | |
| ytVideoId | text null | null = channel-level |
| capturedAt | timestamptz | |
| metrics | jsonb | ctr, retentionCurve, watchTime, revenue, subs, impressions |

### subscriptions / usage_records (billing)
- `subscriptions(id, userId, stripeSubId, planTier, status, currentPeriodEnd)`
- `usage_records(id, userId, period, tokensUsed, videoCredits, musicCredits, costUsd)`

### prompt_versions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| key | text | e.g. `script.longform` |
| version | int | |
| body | text | template |
| active | boolean | |

### audit_logs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK | |
| action | text | publish/edit/compliance_decision/connect_channel/… |
| target | text | entity reference |
| meta | jsonb | |
| createdAt | timestamptz | |

## 4. Key Indexes

- `projects(channelId, state)`, `projects(userId, updatedAt)`
- `jobs(queue, status)`, `jobs(projectId)`, `jobs(correlationId)`
- `assets(projectId, kind, status)`
- `analytics_snapshots(channelId, ytVideoId, capturedAt)`
- `compliance_reports(projectId, createdAt)`
- Unique: `users(email)`, `channels(userId, ytChannelId)`, `prompt_versions(key, version)`

## 5. Integrity & Safety Rules

- A `publish_record` cannot be created unless the linked project has `compliancePassed = true` AND `humanApproved = true` (enforced in service layer + checked again by `PublishingAgent`).
- Editing a `script` or `metadata_draft` after approval resets `compliancePassed` and `humanApproved` to false (WF-7).
- `assets` cannot move to `generating` for music/video/thumbnail until the project's latest `compliance_report.recommendation = pass`.
- Cascade deletes are soft where audit/billing history must persist.

## 6. Migrations

Prisma migrations are the source of truth, versioned in `infra/db/migrations`. No manual schema edits in any environment; all changes flow through reviewed migrations in CI. Seed data lives in `infra/db/seed.ts`.
