# agents.md — AI CreatorForce

## 1. Agent Model

AI CreatorForce uses a **supervised multi-agent** design. A `SupervisorAgent` decomposes a creator goal into a plan of sub-agent tasks and sequences them. Sub-agents are **stateless, idempotent, single-responsibility** functions: typed input → provider call (via the AI Client) → Zod-validated typed output. A `QualityControlAgent` audits outputs that fail validation or quality heuristics.

### Shared contract

```ts
interface Agent<I, O> {
  name: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  promptRef: string;        // versioned key into packages/prompts
  defaultProvider: Provider; // overridable per task
  run(input: I, ctx: AgentContext): Promise<O>;
}
```

`AgentContext` carries: correlation ID, user/channel, budget remaining, trace span, and the AI Client handle. Every `run` emits a trace event `{agent, model, tokens, latencyMs, costUsd, promptVersion}`.

Rules (also in `claude.md`): no agent calls a provider SDK directly; output is always validated; on validation failure, retry up to `MAX_AGENT_RETRIES`, then escalate to `QualityControlAgent`.

## 2. Agent Roster

| Agent | Engine | Responsibility | Key Output |
|-------|--------|----------------|-----------|
| SupervisorAgent | — | Plan, sequence, route, aggregate | Execution plan + final bundle |
| TrendAgent | Trend Intelligence | Discover & score opportunities | Scored topic candidates |
| SEOAgent | SEO Intelligence | Keywords, metadata, ranking difficulty | Titles/desc/tags/chapters + SEO score |
| AudienceAgent | Audience Intelligence | Psychology, hooks, retention strategy | Hooks, emotional angle, audience profile |
| ScriptAgent | Content Intelligence | Long-form & Shorts scripts | Structured script |
| ResearchAgent | Content Intelligence | Gather sourced facts/evidence | Source-cited research pack |
| FactCheckAgent | Content/Compliance | Verify claims against sources | Claim verdicts + confidence |
| ComplianceAgent | Compliance Intelligence | Policy/copyright/monetization review | Compliance report + scores |
| MusicAgent | Music Intelligence | Music brief & generation prompts | Music prompt, genre, BPM, mood |
| VideoAgent | Video Intelligence | Scene plan, shot list, video prompts | Storyboard + provider prompts |
| ThumbnailAgent | Thumbnail Intelligence | Thumbnail concepts & prompts | Thumbnail prompts + CTR prediction |
| MetadataAgent | SEO/Publishing | Finalize publish metadata | Title/desc/tags/hashtags/chapters |
| PublishingAgent | Publishing | Upload/schedule via YouTube API | Publish receipt + video ID |
| AnalyticsAgent | Analytics Intelligence | Interpret channel/video metrics | Growth report |
| GrowthAgent | Analytics Intelligence | Turn analytics into next-video plan | Recommendations + next topics |
| QualityControlAgent | — | Audit/repair failing outputs | Pass/fail + corrected output |

## 3. Agent Specifications

### SupervisorAgent
- **Input:** creator goal, channel context, selected pipeline (full / script-only / assets-only).
- **Behavior:** produces an ordered task graph, dispatches tasks (often as queued jobs), enforces the compliance gate, aggregates results, and surfaces required human-approval checkpoints.
- **Output:** `ExecutionPlan` + assembled `ContentBundle`.
- **Must:** never advance to asset production or publish if compliance has not passed.

### TrendAgent
- **Inputs:** niche, channel history, region, time window, signals (YouTube trends, Google Trends, competitor set).
- **Outputs:** candidate topics each with `trendScore`, `competitionScore`, `revenueScore`, `viralityScore`, `recommendationScore` (0–100) plus rationale.
- **Notes:** consumes cached trend/competitor data; does not invent metrics—scores derive from retrieved signals with documented heuristics.

### SEOAgent
- **Inputs:** chosen topic, target audience, language/region.
- **Outputs:** ranked keywords with search-intent labels, title options, description draft, tags, hashtags, chapter suggestions, `seoScore`, ranking-difficulty estimate, CTR prediction.

### AudienceAgent
- **Inputs:** topic, audience profile, format (long/Shorts).
- **Outputs:** hook variants, emotional angle, retention strategy (pacing, pattern interrupts, open loops), engagement prediction, refined audience profile.
- **Guardrail:** retention tactics must be honest (no clickbait that misrepresents content; see `compliance.md`).

### ScriptAgent
- **Inputs:** topic, hooks, audience strategy, research pack, format, desired length, creator voice profile.
- **Structure (enforced):** Hook → Problem → Story → Evidence → Solution → CTA.
- **Outputs:** sectioned script with timestamps, B-roll/visual cues, citations linked to research, and a "human-add-value" checklist (where the creator should inject original commentary/experience).
- **Guardrail:** must mark any factual statement with a source reference for FactCheckAgent.

### ResearchAgent
- **Inputs:** topic, claims to support.
- **Outputs:** research pack of sources (title, URL, publisher, date, relevant excerpt summary in own words), grouped by claim. Prefers primary/authoritative sources.
- **Guardrail:** no copyrighted text reproduction; summaries paraphrased; store source provenance.

### FactCheckAgent
- **Inputs:** script claims + research pack.
- **Outputs:** per-claim `{verdict: supported|unsupported|needs-source, confidence, evidenceRef}`. Blocks pipeline if unsupported claims remain above threshold.

### ComplianceAgent
- **Inputs:** full content bundle (script, metadata, asset briefs).
- **Outputs:** `complianceScore`, `monetizationRisk`, `copyrightRisk`, advertiser-friendliness assessment, policy flags, and a `recommendation` (pass / revise / block) with specific reasons.
- **Hard gate:** see `compliance.md`. Nothing proceeds to assets/publish on a block.

### MusicAgent
- **Inputs:** mood, genre target, video length, scene energy map.
- **Outputs:** music brief — prompt, genre, BPM, mood, instrument suggestions, structure — formatted for Suno / Udio / Stable Audio. Records that output must be the creator's licensed generation, with provenance.

### VideoAgent
- **Inputs:** script + scene cues, style guide, target provider.
- **Outputs:** scene plan, shot list, per-shot video prompts and parameters for Veo / Kling / Runway / Pika / Luma, and a production workflow checklist. Records provenance and provider ToS notes.

### ThumbnailAgent
- **Inputs:** title options, emotional angle, brand style.
- **Outputs:** 2–4 thumbnail concepts with generation prompts, composition/text recommendations, and CTR predictions for A/B testing.
- **Guardrail:** no misleading imagery; no third-party IP/faces without rights.

### MetadataAgent
- **Inputs:** SEO output + final approved title direction.
- **Outputs:** publish-ready title, description (with chapters and disclosures where required), tags, hashtags, category, language, and AI-disclosure flags per current YouTube policy.

### PublishingAgent
- **Inputs:** approved bundle + schedule.
- **Behavior:** calls YouTube Data API to upload/schedule, sets metadata and thumbnail, applies disclosures. Idempotent; records receipt.
- **Hard gate:** verifies compliance-pass + human approval flag before acting.

### AnalyticsAgent
- **Inputs:** YouTube Analytics metrics (CTR, retention, watch time, revenue, subscribers).
- **Outputs:** growth report with diagnosis (what worked / what didn't) tied to specific metrics.

### GrowthAgent
- **Inputs:** analytics report + channel goals.
- **Outputs:** prioritized optimization actions and next-video topic recommendations, feeding back into TrendAgent.

### QualityControlAgent
- **Inputs:** any agent output that failed validation or quality heuristics.
- **Behavior:** diagnose, attempt repair (re-prompt with constraints), or reject with actionable reason. Last line before human escalation.

## 4. Orchestration Patterns

- **Full pipeline:** Supervisor → Trend → SEO → Audience → (Research ∥ —) → Script → FactCheck → **Compliance gate** → (Music ∥ Video ∥ Thumbnail) → Metadata → **Human review** → Publishing → Analytics → Growth.
- **Parallelism:** Music, Video, and Thumbnail agents run concurrently after compliance passes.
- **Checkpoints:** human-approval pauses are first-class; Supervisor persists state so a workflow can resume after approval.
- **Failure handling:** retries with backoff → QualityControlAgent → human escalation. All failures are traced.

## 5. Provider Strategy

Default model assignment lives in config, not code. Reasoning-heavy agents (Supervisor, Script, Compliance, FactCheck) default to a strong reasoning model; high-volume/cheap tasks may default to a lighter model. The AI Client handles fallback to a secondary provider on outage/rate-limit. See `techstack.md` and `prompts.md`.
