# uiux.md — AI CreatorForce

## 1. Design Principles

- **Pipeline made visible.** The product is a pipeline; the UI should always show where a project is and what's next.
- **Human-in-control.** Approval moments are clear, deliberate, and never accidental.
- **Trust through transparency.** Show sources, compliance reasons, provenance, and cost—not just outputs.
- **Calm density.** Pro tool, not a toy: information-rich but uncluttered; progressive disclosure.
- **Fast feedback.** Long jobs stream progress; nothing feels frozen.

## 2. Visual System

- **Stack:** Next.js + Tailwind + shadcn/ui (accessible, owned-in-repo components).
- **Theme:** dark-first with light option; high-contrast, accessible (WCAG AA).
- **Typography:** one clean sans for UI; monospace for prompts/technical fields.
- **Color semantics:** green = pass/healthy, amber = revise/medium risk, red = block/high risk, neutral = informational. Used consistently for compliance and scores.
- **Density:** cards for entities (topics, projects, assets), tables for lists, side panels for detail.
- Follow the project's frontend design conventions; avoid templated default looks.

## 3. Information Architecture

```
Top nav: Dashboard · Discover · Projects · Assets · Analytics · Approvals · Settings/Billing
Project workspace (left rail = pipeline steps; main = active step; right = context/sources/cost)
```

## 4. Key Screens

### Dashboard
- KPI cards (CTR, watch time, subs, revenue trends — Recharts).
- "Needs your attention": pending approvals, blocked-by-compliance items, failed jobs.
- Quick actions: new project, discover trends.

### Discover (Trend Board)
- Grid of scored opportunity cards: trend/competition/revenue/virality/recommendation scores with color cues.
- Filters (niche, region, evergreen vs trending). "Promote to project" CTA.
- Card detail drawer: rationale, signals, competitor context.

### Project Workspace (the heart)
- **Left rail pipeline:** Discover → Topic → SEO → Audience → Research → Script → Fact-check → Compliance → Assets → Metadata → Review → Publish → Analytics. Current step highlighted; gates marked.
- **Script editor:** sectioned (Hook/Problem/Story/Evidence/Solution/CTA) with timestamps, visual cues, inline citations, and a "human-add-value" checklist nudging original input.
- **Right context panel:** sources (ResearchAgent), fact-check verdicts, cost meter, agent trace.

### Compliance Panel
- Big status (Pass / Revise / Block) with color.
- `complianceScore`, `monetizationRisk`, `copyrightRisk`, advertiser-friendly.
- Flag list: each flag shows location, reason, and how to fix. Block flags clearly non-overridable.

### Asset Studio
- Tabs: Music · Video · Thumbnail.
- Each shows the agent brief/prompt, provider selector, generation button (with credit cost shown), progress, and results with provenance.
- Thumbnail A/B: side-by-side variants with CTR predictions; pick winner.

### Approval Center
- Queue of items awaiting human approval at each checkpoint.
- Approve requires viewing the bundle; explicit confirm. Approving is logged.

### Job / Progress Center
- Live list of running jobs (WS/SSE): step, status, progress, cost. Retry/cancel where allowed.

### Analytics
- Channel overview + per-video detail (retention curve overlaid on script sections).
- Recommendations panel (GrowthAgent) with prioritized actions and next topics.

### Settings / Billing
- Channels (connect/disconnect, scopes, status).
- Voice profiles, brand kit.
- Plan & usage meter (tokens/credits vs limits), Stripe portal.
- Team & roles (Beta+).

## 5. Interaction Patterns

- **Async-first:** actions that enqueue jobs show optimistic "queued" state, then stream progress. Never block the UI on a long call.
- **Gates as moments:** compliance block and approval are dedicated, unmistakable UI states—not buried buttons.
- **Cost visibility:** any action that spends credits/tokens shows the estimated cost first.
- **Editing invalidates approval:** the UI clearly warns that editing an approved item resets compliance + approval (WF-7).
- **Inline reasons:** every refusal/block explains why and what to do.

## 6. Empty / Error / Loading States

- **Empty:** guide to the next action (connect a channel, discover a trend).
- **Loading:** skeletons + streamed step updates; honest progress, never fake spinners.
- **Error:** plain-language cause + recovery (reconnect channel, retry job, adjust budget).
- **Blocked:** distinct, calm treatment; emphasize remediation, not punishment.

## 7. Accessibility

- WCAG AA: keyboard navigable, focus states, sufficient contrast, ARIA on custom components, reduced-motion support. Color is never the sole signal (pair with icon/label).

## 8. Responsive

- Desktop-first (creators work on large screens) but responsive down to tablet; core review/approval usable on mobile.

## 9. Microcopy Tone

- Direct, encouraging, honest. Celebrate genuine wins; never nudge toward deceptive tactics. Compliance copy is matter-of-fact and constructive.

## 10. Components to Build (shadcn-based, indicative)

ScoreBadge, RiskPill, PipelineRail, ScriptSectionEditor, CitationChip, ComplianceFlagList, CostMeter, JobProgressRow, ThumbnailABCompare, ApprovalDialog, ProviderSelect, RetentionChart.
