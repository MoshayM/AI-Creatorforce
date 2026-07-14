# project.md — AI CreatorForce

AI CreatorForce is a production-grade SaaS platform: an AI-powered YouTube Content Operating System that gives creators a complete AI workforce for the full content lifecycle — opportunity discovery, scripting, compliance, media production, SEO, publishing, and post-publish growth — while keeping a human creator in control of quality and final approval at every critical gate. It is not a spam content generator; every feature is designed around original, monetizable content that passes YouTube's policies and the platform's own compliance engine before any output reaches the public.

---

## Related docs

- [architecture.md](architecture.md) — stack, module layout, job pipeline, observability
- [features.md](features.md) — per-feature breakdown (agents, outputs, compliance notes)
- [agents.md](agents.md) — individual agent contracts
- [workflows.md](workflows.md) — multi-step pipeline definitions
- [database.md](database.md) — Prisma schema reference
- [api.md](api.md) — REST + WebSocket surface
- [compliance.md](compliance.md) — compliance engine detail
- [youtube-publishing.md](youtube-publishing.md) — publishing gate and YouTube API integration
- [monetization-framework.md](monetization-framework.md) — billing, credits, subscriptions
- [build.md](build.md) — phased build plan and scope
- [roadmap.md](roadmap.md) — upcoming milestones

---

## Core mission

Help YouTube creators produce original, high-quality, monetization-safe content faster — without removing human judgment from the decisions that matter. The platform automates research, scripting, fact-checking, media production, and distribution while requiring human approval before anything publishes to YouTube.

---

## 7 Golden Rules (non-negotiable)

1. **Compliance is a hard gate, not a suggestion.** No content reaches the Publishing Engine without passing `ComplianceAgent`. `ComplianceService.enforce()` throws `BadRequestException` on failure; there is no bypass path.

2. **Human-in-the-loop on publish.** The platform drafts and recommends; a human approves before anything is uploaded to YouTube, unless the user has explicitly enabled scheduled auto-publish *and* the item has already passed compliance. The `PublishingService` checks for an `Approval` row with `status = 'APPROVED'` and throws `ForbiddenException` if absent.

3. **No fabricated facts.** Any factual claim in a generated script must be traceable to a source captured by `ResearchAgent` and verified by `FactCheckAgent`. Agents that generate prose must not hallucinate citations.

4. **Respect third-party ToS.** YouTube Data API, AI providers (Anthropic/OpenAI/Gemini), video providers (Veo/Kling/Runway/Pika/Luma), and music providers (Suno/Udio/Stable Audio) each have terms. Integrations use official APIs and store provenance metadata on every `AssetVersion`.

5. **Secrets never in code.** All keys via environment variables or secret manager. `.env` is never committed. See [security.md](security.md).

6. **TypeScript strict mode on.** `any` is allowed only with a `// @reason:` comment explaining why it cannot be avoided.

7. **Every agent output is validated.** Agent responses are parsed against a Zod schema before use. On schema failure the agent retries up to `MAX_AGENT_RETRIES`, then routes to `QualityControlAgent`.

---

## High-level platform overview

**Channel workspace** — Users connect YouTube channels via Google OAuth. Each channel stores a niche profile, voice profile, and brand kit. Multiple channels are supported per account.

**AI agent pipeline (long-form content)** — A sequential pipeline of stateless, idempotent agents: `ResearchAgent` → `ScriptAgent` → `FactCheckAgent` → `ComplianceAgent` → `MetadataAgent` → `SEOAgent` → human approval → `PublishingService`. Every step runs as a BullMQ job on the `AGENT_QUEUE`.

**Shorts Studio** — Channel-first workflow. Users pick a channel, explicitly select library videos via a picker, and get transcript analysis, scene detection, topic segmentation, and AI-generated clip recommendations. A timeline editor and AI editing assistant let creators build Shorts sequences; the export/publish path goes through the same compliance gate.

**Media pipeline** — Voice generation (`VoiceAgent`), b-roll image generation (`ImageAgent`), background music generation (`MusicAgent`), video scene planning and generation (`VideoAgent`), subtitle generation (`SubtitleAgent`), edit planning (`EditPlanAgent`), and a render pipeline (Timeline → RenderPreset → ffmpeg → `Render` model → R2 storage).

**Billing and credits** — Polymorphic `Wallet` (user or org), append-only `CreditLedger`, bucketed `CreditLot` (promotional/bonus/referral/purchased/trial with expiry), hold-and-settle `CreditReservation`, Stripe `Subscription` (FREE/STARTER/PRO/AGENCY), and `BudgetPeriod` per org/team.

**Organizations and teams** — `Organization` with `OrgMembership` roles (ORG_ADMIN/TEAM_MANAGER/BILLING_ADMIN/MEMBER), `Team`/`TeamMembership` (OWNER/ADMIN/EDITOR/REVIEWER/VIEWER), and a shared org wallet.

**Trial and growth engine** — `TrialGrant` model, trial credit buckets, `ReferralCode` model with referral credit awards, upgrade engine, marketplace service, and offers service.

**Developer portal** — `DeveloperKey` model, `DeveloperWebhook` model with delivery jobs, external API access via `dev-api` controller, `developer-key` guard.

**Observability and admin** — Sentry error tracking (API + web), Prometheus metrics via `prom-client` on every route, `AuditLog` model for compliance trails, `SystemConfig` for runtime flags, feature-flag module, AI-ops module for prompt version management.

---

## Current build state

| Area | Status |
|---|---|
| Full content pipeline (long-form) | Built |
| Shorts Studio (channel-first flow, timeline editor, clip recs, social factory) | Built |
| Billing / wallet / credits / Stripe integration | Built |
| Organizations, teams, multi-channel | Built |
| Trial grants / referral / growth engine | Built |
| Developer portal (keys, webhooks, external API) | Built |
| Auth (email+password, Google/Apple/Facebook OAuth, JWT + refresh rotation) | Built |
| Compliance engine (SHA-256 cache, scoring, BLOCK severity) | Built |
| Analytics (snapshots, BI module, YouTube Analytics polling) | Built |
| Render pipeline (ffmpeg-static, RenderPreset, R2 storage keys) | Built |

---

## Planned / not yet implemented

- **n8n workflow automation** — The `n8n/` folder exists for exported workflow definitions, but the n8n runtime is not deployed. Workflows need to be imported into a running n8n instance and connected to the API webhook endpoints.
- **Video file generation via external providers** — `VideoAgent` and `MusicAgent` have provider interfaces (Veo/Kling/Runway/Pika/Luma; Suno/Udio/Stable Audio), but actual generation calls are placeholders in the current `publishing.service.ts`. Integration is blocked on provider API access.
- **Stripe production keys** — Billing module is wired; Stripe keys need to be swapped from test to live for production.
- **Multi-region deployment** — Infrastructure is defined for single-region. Horizontal worker scaling (BullMQ) and multi-region Postgres read replicas are not yet provisioned.
- **i18n beyond English** — `targetLang` field exists on the `Project` model; multi-language script generation is not wired through the agent pipeline.
- **Accessibility audit tooling** — `a11y.spec.ts` exists in `apps/e2e` but is not yet integrated into CI.
