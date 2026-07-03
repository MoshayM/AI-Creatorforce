# features.md — AI CreatorForce

Feature specification organized by Core Engine. Each feature notes its primary agent(s), key outputs, and compliance/quality guardrails. Phasing (MVP / Beta / Launch) is in `build.md`.

---

## 1. Trend Intelligence

| Feature | Description | Agent | Output |
|---------|-------------|-------|--------|
| Opportunity Board | Ranked topic candidates for the channel's niche | TrendAgent | Scored cards |
| YouTube Trend Analysis | Surfacing rising topics/formats | TrendAgent | Trend signals |
| Google Trends Analysis | Cross-reference search demand | TrendAgent | Demand curve |
| Competitor Monitoring | Track chosen competitor channels | TrendAgent | Gap analysis |
| Viral Pattern Detection | Identify repeatable winning patterns | TrendAgent | Pattern notes |
| Evergreen Discovery | Durable, low-decay topics | TrendAgent | Evergreen list |
| Opportunity Scoring | Composite recommendation | TrendAgent | trend/competition/revenue/virality/recommendation scores (0–100) |

Guardrail: scores derive from retrieved signals with documented heuristics; no fabricated metrics.

---

## 2. SEO Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Keyword Discovery | Find ranking keywords for a topic | Keyword list w/ intent |
| Search Intent Analysis | Classify informational/commercial/etc. | Intent labels |
| CTR Prediction | Estimate title/thumbnail click appeal | CTR estimate |
| Metadata Optimization | Titles, descriptions, tags, hashtags, chapters | Metadata draft |
| Ranking Difficulty | Estimate competitiveness | Difficulty score |
| SEO Score | Composite metadata quality | seoScore |

---

## 3. Audience Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Audience Psychology | Model viewer motivations | Audience profile |
| Emotional Trigger Analysis | Identify honest emotional angles | Emotional angle |
| Retention Optimization | Pacing, open loops, pattern interrupts | Retention plan |
| Hook Generation | Multiple opening hook variants | Hook set |
| Engagement Prediction | Estimate likes/comments/shares potential | Engagement estimate |

Guardrail: hooks/retention tactics must not misrepresent content (no deceptive clickbait).

---

## 4. Content Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Long-form Script Writing | Full structured scripts | Sectioned script |
| Shorts Script Writing | Tight vertical scripts | Shorts script |
| Educational Content | Explainer formats | Script |
| Documentary Content | Narrative non-fiction | Script |
| Storytelling Content | Story-driven formats | Script |
| Research Pack | Sourced evidence per claim | Citations |
| Fact Checking | Verify claims vs sources | Verdicts |
| Human-Value Checklist | Marks where creator adds original input | Checklist |

Structure enforced: **Hook → Problem → Story → Evidence → Solution → CTA.**
Guardrail: factual claims carry source references; unsupported claims block the pipeline.

---

## 5. Compliance Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Copyright Verification | Flag potential infringement risk | copyrightRisk |
| Monetization Verification | Advertiser-friendliness & policy fit | monetizationRisk |
| AI Content Review | Disclosure needs, synthetic-media flags | Disclosure flags |
| Advertiser-Friendly Review | Sensitive-topic assessment | Ad-safety notes |
| Platform Policy Review | YouTube policy alignment | Policy flags |
| Compliance Gate | Pass/revise/block decision | complianceScore + recommendation |

This is the platform's hard gate. See `compliance.md`.

---

## 6. Music Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Music Selection | Match mood/energy to scenes | Selection guidance |
| Music Recommendation | Genre/BPM/instrument suggestions | Music brief |
| AI Music Generation Workflow | Guided prompts for Suno/Udio/Stable Audio | Provider-ready prompt |

Guardrail: generated music is the creator's own licensed output; provenance stored; no use of copyrighted tracks without rights.

---

## 7. Video Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Scene Planning | Break script into scenes | Scene plan |
| Storyboarding | Visualize sequence | Storyboard |
| Shot Sequencing | Order and pacing of shots | Shot list |
| Video Prompt Generation | Provider-ready prompts | Veo/Kling/Runway/Pika/Luma prompts |
| Production Workflow | Step-by-step generation checklist | Workflow |

Guardrail: provenance + provider ToS compliance recorded per asset.

---

## 8. Thumbnail Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Thumbnail Generation | Concept + image prompts | Thumbnail prompts |
| A/B Testing | Compare variants | Variant set |
| CTR Optimization | Predict & improve click appeal | CTR prediction |

Guardrail: no misleading imagery; no third-party IP/faces without rights.

---

## 9. Publishing

| Feature | Description | Output |
|---------|-------------|--------|
| YouTube Upload | Direct upload via Data API | Video ID |
| Scheduling | Schedule future publish | Scheduled job |
| Metadata Publishing | Apply title/desc/tags/chapters | Applied metadata |
| Thumbnail Publishing | Set custom thumbnail | Applied thumbnail |
| Disclosure Application | Apply AI/altered-content disclosures | Disclosure set |

Hard precondition: compliance pass + human approval. See `youtube-publishing.md`.

---

## 10. Analytics Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| CTR Analysis | Click-through diagnostics | Insight |
| Retention Analysis | Retention curve interpretation | Drop-off points |
| Watch Time Analysis | Watch-time trends | Insight |
| Revenue Analysis | RPM/revenue trends | Insight |
| Subscriber Analysis | Sub growth/source | Insight |
| Growth Report | Consolidated diagnosis | Report |
| Optimization Suggestions | Concrete next actions | Action list |
| Next Video Recommendations | Topic ideas from data | Topic seeds |

---

## Cross-Cutting Platform Features

- **Channel & Project Management:** connect YouTube channels (OAuth), organize work into projects, track status across the pipeline.
- **Voice Profiles:** capture a creator's tone/style for consistent scripts.
- **Brand Kit:** colors, fonts, thumbnail style, reused across assets.
- **Job/Progress Center:** live status of queued generation jobs (WS/SSE).
- **Budget & Usage Meter:** real-time token/credit spend vs plan limits.
- **Asset Library:** scripts, music, video clips, thumbnails in R2 with provenance.
- **Approval Center:** human checkpoints surfaced for review/sign-off.
- **Team & Roles (Beta+):** RBAC for multi-user teams and agencies.
- **Audit Log:** every publish, edit, and compliance decision is logged.
- **Notifications:** email/in-app for job completion, approvals, publish results.
