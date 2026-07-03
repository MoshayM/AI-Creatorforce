# claude.md — AI CreatorForce

> Operating contract for Claude Code (and any AI coding agent) working in this repository.
> Read this file fully before writing or modifying code.

---

## 1. What This Project Is

**AI CreatorForce** is a production-grade SaaS platform: an AI-powered YouTube Content Operating System. It helps creators discover opportunities, generate **original, monetizable** content, plan videos, optimize SEO, publish, and continuously improve channel performance.

This is **not** a spam content generator. Every feature must reinforce: original content, human-added value, copyright compliance, monetization compliance, fact verification, audience retention, long-term channel growth, and creator productivity.

If a requested change would weaken any of those principles, stop and flag it in your response rather than implementing it silently.

---

## 2. Golden Rules (non-negotiable)

1. **Compliance is a hard gate, not a suggestion.** No content reaches the Publishing Engine without passing the Compliance Intelligence Engine. Never add a code path that bypasses `ComplianceAgent`.
2. **Human-in-the-loop on publish.** The platform drafts and recommends; a human approves before anything is uploaded to YouTube, unless the user has explicitly enabled scheduled auto-publish *and* the item already passed compliance.
3. **No fabricated facts.** Any factual claim in generated scripts must be traceable to a source captured by `ResearchAgent` and verified by `FactCheckAgent`.
4. **Respect third-party ToS.** YouTube Data API, AI providers (Claude/OpenAI/Gemini), video providers (Veo/Kling/Runway/Pika/Luma), and music providers (Suno/Udio/Stable Audio) each have terms. Integrations must use official APIs/workflows and store provenance metadata.
5. **Secrets never in code.** All keys via environment variables / secret manager. Never commit `.env`. See `security.md`.
6. **Type safety end to end.** TypeScript strict mode on. No `any` without a `// @reason:` comment.
7. **Every agent output is validated.** Agent responses are parsed against a Zod schema before use. Reject and retry on schema failure.

---

## 3. Repository Map

```
creatorforce-ai/
├── claude.md                  ← you are here
├── docs/                      ← all design docs (read these for context)
│   ├── project.md
│   ├── architecture.md
│   ├── agents.md
│   ├── workflows.md
│   ├── features.md
│   ├── api.md
│   ├── techstack.md
│   ├── database.md
│   ├── security.md
│   ├── compliance.md
│   ├── monetization-framework.md
│   ├── youtube-publishing.md
│   ├── analytics.md
│   ├── deployment.md
│   ├── build.md
│   ├── roadmap.md
│   ├── testing.md
│   ├── uiux.md
│   └── prompts.md
├── apps/
│   ├── web/                   ← Next.js frontend
│   └── api/                   ← NestJS backend
├── packages/
│   ├── agents/                ← AI agent implementations
│   ├── shared/                ← shared types, Zod schemas, utils
│   ├── prompts/               ← versioned prompt templates
│   └── config/                ← eslint/tsconfig/tailwind presets
├── infra/                     ← Docker, IaC, GitHub Actions
└── n8n/                       ← exported workflow definitions
```

---

## 4. Where To Look Before Coding

| If you are changing… | Read first |
|----------------------|-----------|
| An agent's behavior | `docs/agents.md`, `docs/prompts.md` |
| A multi-step pipeline | `docs/workflows.md` |
| API surface | `docs/api.md` |
| Data model / migrations | `docs/database.md` |
| Anything touching publish | `docs/youtube-publishing.md`, `docs/compliance.md` |
| Anything touching money | `docs/monetization-framework.md` |
| Auth, secrets, PII | `docs/security.md` |
| Build phases / scope | `docs/build.md`, `docs/roadmap.md` |

---

## 5. Coding Conventions

- **Monorepo** managed with pnpm workspaces + Turborepo.
- **Language:** TypeScript everywhere. `strict: true`.
- **Backend:** NestJS modules mirror the Core Modules (one module per engine).
- **Frontend:** Next.js App Router, Server Components by default, Client Components only when interactive.
- **Validation:** Zod at every boundary (API input, agent output, env vars).
- **Errors:** Throw typed domain errors; never swallow. Surface to Sentry.
- **Async work:** Anything > 2s or calling an external AI/video/music provider runs as a BullMQ job, never inline in a request handler.
- **Naming:** `PascalCase` types/classes, `camelCase` vars/functions, `SCREAMING_SNAKE` env vars, `kebab-case` files/routes.
- **Tests:** Co-locate `*.spec.ts`. New features require unit tests; pipelines require integration tests. See `docs/testing.md`.

---

## 6. Agent Development Rules

When adding or editing an agent (`packages/agents/`):

1. Define input + output **Zod schemas** in `packages/shared`.
2. Pull the prompt from `packages/prompts` (versioned), never inline a large prompt in code.
3. Wrap the provider call with the shared `aiClient` (handles retries, fallback provider, token accounting, tracing).
4. Validate output against the schema; on failure, retry up to `MAX_AGENT_RETRIES` then route to `QualityControlAgent`.
5. Emit a structured trace event (agent name, model, tokens, latency, cost).
6. The `SupervisorAgent` orchestrates; individual agents must remain stateless and idempotent.

---

## 7. Commit & PR Expectations

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- One logical change per PR. Update relevant docs in the same PR.
- CI must pass: lint, typecheck, unit tests, build. See `docs/deployment.md`.
- Never merge a PR that disables a compliance check, weakens auth, or removes provenance metadata without explicit sign-off noted in the PR body.

---

## 8. Definition of Done

A task is done when: code compiles under strict TS, tests pass, lint is clean, docs are updated, secrets are externalized, the change has observable traces/metrics, and—if it touches the content pipeline—compliance gating is intact and verified by a test.

---

## 9. When In Doubt

Prefer asking over guessing on: anything that publishes externally, anything that spends money (provider tokens, video/music generation credits, Stripe), and anything that touches user PII or OAuth tokens. State assumptions explicitly in your response.
