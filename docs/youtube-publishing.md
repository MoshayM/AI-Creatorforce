# youtube-publishing.md — AI CreatorForce

This document describes how AI CreatorForce connects to YouTube, validates content before upload, and manages video publishing and post-publish analytics via the YouTube Data API. Related reading: [compliance.md](compliance.md), [security.md](security.md), [database.md](database.md).

> How AI CreatorForce connects to YouTube and publishes content via the **YouTube Data API**, with hard gates ensuring nothing ships without compliance pass + human approval.

> **Policy/quota note:** YouTube Data API quotas, scopes, upload limits, and disclosure requirements change. Verify current YouTube Data API documentation and YouTube policies (as of build time) before implementing. The values and behaviors below reflect current best practices as of June 2026.

---

## OAuth Connection

A creator connects a YouTube channel via Google OAuth (the Google adapter in `ProviderRegistry`). During the OAuth flow:

- Granted scopes are stored in `Channel.scopes[]` for audit.
- OAuth tokens (access + refresh) are encrypted at rest using **jose** (JWE, AES-256-GCM) with `TOKEN_ENCRYPTION_KEY`. The encrypted blob is stored in `Channel.encryptedTokens`; expiry is stored in `Channel.tokenExpiresAt`.
- **`Channel.readOnly`** flag marks connections that were granted analytics-only scopes — no upload capability. The publish flow rejects read-only channels.
- **`Channel.active`** flag allows soft-disabling a channel without removing OAuth credentials.

---

## Token Management

`ChannelsService.buildAuthedYouTube(channelId)` is the single point of access for an authenticated YouTube API client:

1. Fetches the `Channel` record and decrypts `encryptedTokens` using `TOKEN_ENCRYPTION_KEY`.
2. Constructs a `google-auth-library` OAuth2 client with the decrypted credentials.
3. Returns a `youtube` googleapis client bound to that credential.

Token refresh on expiry is handled by the googleapis library's built-in refresh logic. Explicit proactive refresh on token expiry is not yet implemented (see Planned section).

---

## Publish Preconditions

All five conditions must be satisfied before `youtube.videos.insert` is called. Failure at any step throws and aborts the publish.

| # | Condition | Error on failure |
|---|-----------|-----------------|
| 1 | `ComplianceResult.passed = true` for the associated job | `BadRequestException` (via `ComplianceService.enforce()`) |
| 2 | `Approval.status = 'APPROVED'` for the job | `ForbiddenException` |
| 3 | `Approval.expiresAt` not yet reached | `ForbiddenException` |
| 4 | `videoFilePath` provided and non-empty | `BadRequestException` |
| 5 | `Channel.active = true` and `Channel.readOnly = false` | `ForbiddenException` |

---

## Publish Flow (PublishingService.publish())

Sequence for an immediate or scheduled publish:

1. **Approval check** — query `Approval` by job ID. Assert `status = 'APPROVED'` and `expiresAt > now()`. Throw `ForbiddenException` on any failure.
2. **Video file check** — assert `videoFilePath` is present. Throw `BadRequestException` if missing.
3. **Build authenticated client** — call `ChannelsService.buildAuthedYouTube(channelId)`.
4. **Insert video** — call `youtube.videos.insert` with:
   - `part: ['snippet', 'status']`
   - `snippet`: `title`, `description`, `tags[]`, `categoryId` (default `'22'` — People & Blogs)
   - `status`:
     - Immediate publish: `privacyStatus: 'public'`
     - Scheduled publish: `privacyStatus: 'private'`, `publishAt: <ISO 8601 timestamp>`
   - `media.body`: readable stream from `createReadStream(videoFilePath)`
5. **Update `Video` model** — write back `youtubeVideoId` (from API response), and set:
   - Immediate: `status = PUBLISHED`, `publishedAt = now()`
   - Scheduled: `status = SCHEDULED`, `scheduledAt = <publishAt>`

---

## Scheduled Publish

When `scheduledAt` is set on the publish request, the video is uploaded to YouTube immediately as `privacyStatus: 'private'` with `publishAt` set to the target timestamp. YouTube's infrastructure handles the timed public release — the platform does not need to trigger a second API call at publish time.

`Video.status` is set to `SCHEDULED` in the database until YouTube makes the video public.

---

## Post-Publish Statistics

`getVideoStats(channelId, youtubeVideoId)` calls `youtube.videos.list` with the `statistics` part to retrieve `viewCount`, `likeCount`, `commentCount`, and related fields. This is consumed by `AnalyticsService` for the channel analytics dashboard.

---

## Channel Library Sync

Library sync reads the connected channel's uploaded videos and playlists via the YouTube Data API and populates `LibraryVideo` and `LibraryPlaylist` models in the local database. These models back:

- The **Shorts Studio import picker** — users select from their existing library videos to use as references or source material.
- **Analytics dashboards** — historical performance data for the creator's existing content.

---

## Shorts Publishing

Shorts go through the same compliance and human approval gates as long-form videos. No separate gate or bypass exists. Publishing is available to all authenticated users — there is no per-user publish-access grant system. The render preset `RenderPreset.SHORTS_1080X1920` produces the correct 9:16 aspect ratio. The video is published as a standard YouTube video; YouTube automatically categorizes it as a Short based on duration (<=60 s) and aspect ratio.

**Original audio language:** When a Short is published, `PublishingService` sets `snippet.defaultAudioLanguage` on the upload request to the value stored in `ImportedVideo.originalAudioLanguage`. This field is populated from the source video's YouTube `snippet.defaultAudioLanguage` at import time. Viewers hear the original language unless they switch audio tracks.

Shorts-specific metadata fields (audience designation, Shorts-specific category) are not yet implemented (see Planned section).

---

## Chapter Sync Error Handling

Chapter sync errors returned by the YouTube Data API are surfaced to the user with actionable messages. Specifically, an `invalid_grant` error (expired or revoked OAuth tokens) displays a prompt to reconnect the channel rather than a generic failure message.

---

## API Quota

YouTube Data API has a daily upload quota per project. The platform must handle quota exhaustion (`quotaExceeded` error from the API) gracefully. Quota management, automatic retry with exponential backoff, and quota monitoring are not yet implemented — planned as a follow-on.

---

## Planned / Not Yet Implemented

- **In-app video generation pipeline** — currently `videoFilePath` must be supplied externally by the user. Connecting the in-app render pipeline output directly to `PublishingService` is Phase 2.
- **YouTube API quota management** — quota tracking, graceful exhaustion handling, and retry backoff.
- **Automatic proactive token refresh** — currently relies on googleapis library's on-demand refresh. Explicit pre-expiry refresh to avoid mid-upload failures is not implemented.
- **Shorts-specific metadata fields** — audience designation, Shorts category, and other Shorts-specific API parameters.
