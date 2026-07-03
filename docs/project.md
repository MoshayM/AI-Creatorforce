# project.md — AI CreatorForce

## Overview

AI CreatorForce is an AI-powered **YouTube Content Operating System**. It acts as a complete AI workforce for YouTube creators, automating the full lifecycle from opportunity discovery to post-publish growth optimization while keeping a human creator in control of quality and final approval.

The platform is built around a principle of **augmentation, not replacement**: AI does the heavy, repetitive, research-intensive work; the creator supplies judgment, voice, and originality. Output is designed to be monetization-safe and policy-compliant under YouTube's rules as of June 2026.

## Mission

Help serious creators ship more original, higher-performing videos in less time, without sacrificing quality, originality, or monetization eligibility.

## Non-Goals (explicit)

- Mass-producing low-effort or reused content ("content farms").
- Auto-generating videos with zero human review.
- Scraping or republishing third-party content.
- Gaming engagement metrics or manufacturing fake interactions.
- Anything that risks demonetization, strikes, or channel termination.

## Target Users

| Segment | Need |
|---------|------|
| Solo creators | Do the work of a 5-person team |
| Faceless/automation channels (legitimate) | Original, value-added content at scale, compliant with reuse policy |
| Small media teams | Coordinated pipeline, role-based workflows |
| Agencies | Manage many channels with governance and reporting |

## Value Proposition

1. **Find the right topic** — data-backed opportunity scoring instead of guesswork.
2. **Write strong scripts** — structured, retention-optimized, fact-checked.
3. **Stay monetizable** — compliance gating before anything ships.
4. **Produce assets** — guided workflows for AI music, video, and thumbnails.
5. **Publish & schedule** — direct YouTube integration.
6. **Grow** — analytics that translate into the next video's plan.

## Core Modules (summary)

1. Trend Intelligence Engine
2. SEO Intelligence Engine
3. Audience Intelligence Engine
4. Content Intelligence Engine
5. Compliance Intelligence Engine
6. Music Intelligence Engine
7. Video Intelligence Engine
8. Thumbnail Intelligence Engine
9. Publishing Engine
10. Analytics Intelligence Engine

Each engine maps to a NestJS backend module and one or more AI agents. See `architecture.md` and `agents.md`.

## End-to-End Flow (happy path)

```
Discover → Plan → Research → Script → Fact-check → Compliance gate
   → Assets (music / video / thumbnail) → Metadata/SEO → Human review
   → Publish/Schedule → Analytics → Growth recommendation → (loop)
```

Compliance is a **mandatory gate** between content creation and asset production/publishing. Human review is a **mandatory gate** before publish (unless trusted auto-schedule is explicitly enabled for an already-approved item).

## Success Metrics (platform)

- Time from idea → published video reduced by ≥ 60%.
- ≥ 95% of generated drafts pass compliance on first or second pass.
- Measurable improvement in creator CTR and average view duration after 30 days of use.
- Zero platform-caused monetization strikes attributable to generated content.

## Key Constraints

- Must comply with YouTube Terms, Community Guidelines, and the Inauthentic/Reused Content and AI-disclosure expectations current as of June 2026. Verify current policy at build time; see `compliance.md`.
- All external AI/video/music providers used only via official APIs or sanctioned export workflows, with provenance stored.
- Costs must be metered and capped per user/plan (see `monetization-framework.md`).

## Document Index

| Doc | Purpose |
|-----|---------|
| `claude.md` | AI coding agent operating contract |
| `architecture.md` | System architecture |
| `agents.md` | AI agent roster & contracts |
| `workflows.md` | Orchestrated pipelines |
| `features.md` | Feature specification |
| `api.md` | REST/WS API design |
| `techstack.md` | Technology choices |
| `database.md` | Data model & schema |
| `security.md` | Security architecture |
| `compliance.md` | Policy & content compliance |
| `monetization-framework.md` | Revenue, billing, cost control |
| `youtube-publishing.md` | YouTube integration |
| `analytics.md` | Analytics & growth |
| `deployment.md` | Infra & CI/CD |
| `build.md` | Phased build plan |
| `roadmap.md` | Product roadmap |
| `testing.md` | Test strategy |
| `uiux.md` | UI/UX spec |
| `prompts.md` | Prompt library |
