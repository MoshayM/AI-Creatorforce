# 00_MASTER_CONTEXT.md — AI CreatorForce

> **This file is an index, not a specification.** It orients any human or AI coding agent in ≤ 10 minutes, then routes them to the single owner document for every topic. Detailed content is never duplicated here. If this file and an owner document ever disagree, the owner document wins and this index must be fixed in the same PR.

**Version:** 1.0 · **Status:** Active · **Owner:** Architecture

---

## 1. Project Vision (summary)

**AI CreatorForce** is an AI-powered **YouTube Content Operating System** — a complete AI workforce that takes a creator from opportunity discovery through script, compliance, asset production (voice, music, video, images, thumbnails), timeline editing, rendering, publishing, and analytics-driven growth, while a human retains editorial control and final approval.

Core stance: **augmentation, not replacement**. The platform must never function as a spam/content-farm engine, never bypass compliance, and never publish without prior human approval.

Full vision, personas, success metrics, non-goals → **`project.md`**.

---

## 2. Architecture Overview (summary)

Modular monolith (NestJS) + async job backbone (Redis/BullMQ) + Next.js frontend + n8n for long human-paused workflows. One backend module per Intelligence Engine. All model calls flow through a single **AI Client** layer (provider abstraction, routing, fallback, metering, tracing). Media lives in Cloudflare R2 with write-once provenance; relational truth in PostgreSQL (Prisma).

```
Web (Next.js) → API (NestJS: engine modules) → Agent Runtime (Supervisor + sub-agents)
     ↓                    ↓                            ↓
  WS/SSE          Redis/BullMQ queues            AI Client → LLM / voice / music /
     ↓                    ↓                            video / image providers
 Job status        PostgreSQL · R2 · n8n
```

Two hard gates shape every pipeline: **Compliance gate** (before asset spend and publish) and **Human approval** (before publish). Editing anything after approval resets both (WF-7).

Diagrams, layers, lifecycle → **`architecture.md`**.

---

## 3. Development Rules (summary)

- Read the owner doc before changing an area (routing table in §7 below).
- TypeScript strict everywhere; Zod at every boundary (API input, agent output, env).
- Anything > 2s or touching an external provider runs as a BullMQ job, never inline.
- Conventional Commits; one logical change per PR; docs updated in the same PR.
- Definition of Done: compiles strict, tests pass, lint clean, docs updated, secrets externalized, traces emitted, compliance gating intact and test-verified.

Full operating contract for coding agents → **`claude.md`**.

---

## 4. AI Rules (summary)

1. **No agent calls a provider SDK directly** — only the AI Client (`model-routing.md`).
2. **Every agent output is Zod-validated**; failure → retry → QualityControlAgent.
3. **No fabricated facts** — claims trace to ResearchAgent sources, verified by FactCheckAgent.
4. **Compliance is a hard gate with no bypass path** (`compliance.md`).
5. **Untrusted content is data, never instructions** — prompt-injection defenses in `prompts.md` §6 and `security.md` §10.
6. **Prompts are versioned assets** in `packages/prompts`, never inlined in code.
7. **Budget checked before dispatch**; every call metered (`token-optimization.md`, `monetization-framework.md`).
8. **Provenance is write-once** on every generated asset.

---

## 5. Coding Rules (summary)

- `PascalCase` types/classes · `camelCase` vars/functions · `SCREAMING_SNAKE` env · `kebab-case` files/routes.
- Server Components by default; Client Components only for interactivity.
- Typed domain errors; never swallow; Sentry-surfaced.
- Tests co-located `*.spec.ts`; the mandatory gate tests in `testing.md` §3 may never be weakened to make a feature pass.

Full conventions → **`claude.md`** §5–§8.

---

## 6. Folder Structure

Owned by **`build.md` §2** (single source of truth; `claude.md` references it). Summary:

```
creatorforce-ai/
├── claude.md            # AI coding agent contract
├── docs/                # all documents indexed in §7
├── apps/web             # Next.js App Router
├── apps/api             # NestJS engine modules + workers
├── packages/agents      # Supervisor + sub-agents
├── packages/shared      # types, Zod schemas, AI Client
├── packages/prompts     # versioned prompt templates
├── packages/config      # eslint/tsconfig/tailwind presets
├── infra/               # docker, db (prisma), CI, grafana
└── n8n/                 # exported workflow JSON
```

---

## 7. Documentation Index (routing table)

Numbered scheme maps onto owner files. Exactly one owner per topic.

| # | Recommended name | Owner file | Covers | Status |
|---|------------------|-----------|--------|--------|
| 00 | MASTER_CONTEXT | `00_MASTER_CONTEXT.md` | This index | ✅ |
| 01 | PRODUCT | `project.md` | Vision, users, modules, metrics, non-goals | ✅ |
| 02 | ARCHITECTURE | `architecture.md` | System design, layers, lifecycle, scaling posture | ✅ |
| 03 | DATABASE | `database.md` | Schema, integrity rules, indexes, migrations | ✅ updated |
| 04 | API | `api.md` | REST/WS surface, conventions, errors | ✅ updated |
| 05 | AI_SYSTEM | `agents.md` + `prompts.md` | Agent roster & contracts · prompt library & injection defense | ✅ updated |
| 06 | WORKFLOW | `workflows.md` | WF-1…WF-7 orchestrated pipelines, gates, idempotency | ✅ updated |
| 07 | MEDIA_PIPELINE | `media-pipeline.md` | Voice, subtitles, images, media versioning, render pipeline | ✅ |
| 08 | VIDEO_EDITOR | `video-editor.md` | Timeline model, effects/transitions, preview, undo/redo, shortcuts | ✅ |
| 09 | STORAGE | `media-pipeline.md` §Storage + `architecture.md` §3.7 | R2, provenance, lifecycle, version history | ✅ (merged owner) |
| 10 | PUBLISHING | `youtube-publishing.md` | OAuth, gates, upload, scheduling, disclosures, quotas | ✅ |
| 11 | ANALYTICS | `analytics.md` | Metrics, diagnosis, growth loop, dashboards | ✅ |
| 12 | SECURITY | `security.md` | Auth, RBAC, secrets, OAuth tokens, AI security, SDLC | ✅ |
| 13 | MODEL_ROUTING | `model-routing.md` | 8-provider abstraction, auto-selection, health, fallback | ✅ |
| 14 | TOKEN_OPTIMIZATION | `token-optimization.md` | Compression, caching, semantic memory, incremental regen, budgets | ✅ |
| 15 | DEPLOYMENT | `deployment.md` | Environments, topology, CI/CD, DR, cost | ✅ |
| 16 | TESTING | `testing.md` | Pyramid, mandatory gate tests, fixtures, CI gating | ✅ |
| 17 | ADMIN | `admin.md` | Back-office, abuse monitoring, feature flags, prompt-ops | ✅ |
| 18 | ROADMAP | `roadmap.md` + `build.md` | Product milestones · implementation phases & build order | ✅ |
| — | COMPLIANCE | `compliance.md` | The hard gate: checks, severity, invariants | ✅ (load-bearing; read early) |
| — | MONETIZATION | `monetization-framework.md` | Plans, billing, budgets, creator-monetization safety | ✅ |
| — | UIUX | `uiux.md` | Screens, interaction patterns, accessibility | ✅ (minor update pending: Editor screen — spec in video-editor.md §4) |
| — | README | `README.md` | Public repo entry point | ✅ |

**Read order for a new contributor:** `00_MASTER_CONTEXT.md` → `claude.md` → `project.md` → `architecture.md` → `compliance.md` → the owner doc for your task.

---

## 8. Current Status

- **Documented & stable:** discovery → script → fact-check → compliance → metadata → publish → analytics loop; agents 1–16; WF-1…WF-7; schema; API; security; billing.
- **Gap closed in this documentation pass:** in-app production — voice generation, subtitle generation, general image generation, timeline editing, effects/transitions, rendering, media version history; extended model routing (Claude/OpenAI/Gemini/DeepSeek/Grok/Mistral/OpenRouter/Ollama); token-optimization policy; admin back-office.
- **Agent roster delta (to land in `agents.md`):** +VoiceAgent, +SubtitleAgent, +ImageAgent, +EditPlanAgent, +Render service (deterministic worker — not an LLM agent).
- **Invariant unchanged by all of the above:** production steps run only on a compliance-passed bundle; render output publishes only after human approval.

---

## 9. Roadmap Summary

| Milestone | Focus | North-star |
|-----------|-------|-----------|
| 0 Foundations | Scaffold, AI Client, schema, auth, YouTube connect, **compliance gate first** | One agent runs end-to-end safely |
| 1 MVP | Idea → script → compliance → metadata → publish (asset briefs only) | Time idea→publish; compliance first-pass rate |
| 2 Beta | In-app asset generation, **media pipeline + editor + render**, analytics loop, teams | CTR/retention lift; pipeline completion |
| 3 Launch | Agencies, scale, quota-aware scheduling, DR, hardening | Reliability; cost per published video |
| 4 Post-launch | Channel memory, series/calendar, localization, collaboration | Creator retention; videos per active user |

Details → **`roadmap.md`** (product) and **`build.md`** (implementation phases, sprint order).

---

## 10. Maintenance Rules for This File

1. Adding/renaming a doc → update §7 in the same PR.
2. Never move detailed content into this file; link to it.
3. Status flags (✅/🔲) reflect reality, not intention.
4. Keep under 10 pages.
