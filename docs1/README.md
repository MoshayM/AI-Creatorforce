# AI CreatorForce

> **The AI Content Operating System for YouTube creators** — from opportunity discovery to a published, compliant, monetizable video, with a human always in control.

AI CreatorForce is a production-grade SaaS platform that acts as a complete AI workforce: it finds data-backed video opportunities, writes sourced and fact-checked scripts, enforces a **hard compliance gate** (copyright, monetization, disclosure, policy), generates the media (voice, images, music, video clips, thumbnails, subtitles), assembles a first-cut **timeline you can edit in-app**, renders the final video, publishes to YouTube, and turns analytics into the next video's plan.

**What it is not:** a content farm, an auto-publisher, or a policy-evasion tool. Every pipeline has mandatory fact-check and compliance gates and a human approval step before publish. See [`docs/compliance.md`](docs/compliance.md).

---

## The Pipeline

```
Discover → Plan → Research → Script → Fact-check → COMPLIANCE GATE
   → Voice · Music · Video · Images · Thumbnails (parallel, in-app)
   → AI First Cut → Timeline Editor → Subtitles → Render
   → Metadata + Disclosures → HUMAN APPROVAL → Publish → Analytics → Growth → (loop)
```

## Tech Stack

- **Frontend:** Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui
- **Backend:** NestJS modular monolith, PostgreSQL (+pgvector) via Prisma, Redis + BullMQ, Cloudflare R2
- **AI:** multi-provider AI Client — Claude, OpenAI, Gemini, DeepSeek, Grok, Mistral, OpenRouter, Ollama — with quality-floor routing, fallback, caching, and budget enforcement ([`docs/model-routing.md`](docs/model-routing.md))
- **Media:** TTS (ElevenLabs/OpenAI/Google), image/video/music providers via official APIs, deterministic FFmpeg render workers
- **Automation:** n8n for long human-paused workflows · **Billing:** Stripe · **Observability:** Sentry, Prometheus, Grafana, OpenTelemetry
- **Infra:** Cloudflare + AWS, Docker, GitHub Actions, Terraform-style IaC

## Monorepo

```
apps/web · apps/api · packages/{agents,shared,prompts,config} · infra · n8n · docs
```

pnpm workspaces + Turborepo. Structure owner: [`docs/build.md`](docs/build.md) §2.

## Quick Start (local)

```bash
corepack enable && pnpm install
cp .env.example .env          # provider keys optional locally (Ollama routing for dev)
docker compose up -d          # postgres, redis, n8n
pnpm db:migrate && pnpm db:seed
pnpm dev                      # web + api + workers
```

## Documentation

Start at [`docs/00_MASTER_CONTEXT.md`](docs/00_MASTER_CONTEXT.md) — the index that routes every topic to its single owner document. Coding agents must read [`claude.md`](claude.md) first.

Key documents: [`project.md`](docs/project.md) · [`architecture.md`](docs/architecture.md) · [`agents.md`](docs/agents.md) · [`workflows.md`](docs/workflows.md) · [`media-pipeline.md`](docs/media-pipeline.md) · [`video-editor.md`](docs/video-editor.md) · [`model-routing.md`](docs/model-routing.md) · [`token-optimization.md`](docs/token-optimization.md) · [`compliance.md`](docs/compliance.md) · [`youtube-publishing.md`](docs/youtube-publishing.md) · [`security.md`](docs/security.md) · [`admin.md`](docs/admin.md)

## Core Principles

1. **Compliance is a hard gate** — no bypass path exists, by design and by test.
2. **Human-in-the-loop** — a creator approves everything that publishes.
3. **No fabricated facts** — every claim is sourced and verified.
4. **Provenance everywhere** — every generated asset records how it was made.
5. **Token-efficient by architecture** — cache, compress, regenerate only the delta.

## Plans

**Free** (trial) · **Creator** · **Pro** · **Agency**. Budgets metered per plan; costs shown before every paid action. See [`docs/monetization-framework.md`](docs/monetization-framework.md).

---

*Built to be developed with AI coding agents. Contract: [`claude.md`](claude.md).*
