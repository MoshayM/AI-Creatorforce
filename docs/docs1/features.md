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

Guardrail: scores derive from retrieved signals with documented heuristics; no fabricated metrics. Candidates dedupe against channel memory (`token-optimization.md` §8).

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
| Educational / Documentary / Storytelling formats | Format-specific structures | Script |
| Section Regeneration | Regenerate one section only (cost-efficient) | Updated section |
| Research Pack | Sourced evidence per claim | Citations |
| Fact Checking | Verify claims vs sources (changed claims only on revision) | Verdicts |
| Human-Value Checklist | Marks where creator adds original input | Checklist |

Structure enforced: **Hook → Problem → Story → Evidence → Solution → CTA.**
Guardrail: factual claims carry source references; unsupported claims block the pipeline.

---

## 5. Compliance Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Copyright Verification | Flag potential infringement risk | copyrightRisk |
| Monetization Verification | Advertiser-friendliness & policy fit | monetizationRisk |
| AI Content Review | Disclosure needs, synthetic-media flags (incl. voice/image/video) | Disclosure flags |
| Advertiser-Friendly Review | Sensitive-topic assessment | Ad-safety notes |
| Platform Policy Review | YouTube policy alignment (versioned rule set) | Policy flags |
| Compliance Gate | Pass/revise/block decision | complianceScore + recommendation |
| Diff Re-review | Efficient re-review of edits (WF-7) | Updated report |

This is the platform's hard gate. See `compliance.md`.

---

## 6. Music Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Music Selection | Match mood/energy to scenes | Selection guidance |
| Music Recommendation | Genre/BPM/instrument suggestions | Music brief |
| AI Music Generation | In-app generation via configured providers | Track asset (versioned, provenance) |

Guardrail: generated music is the creator's own licensed output; provenance stored; no use of copyrighted tracks without rights.

---

## 7. Voice Intelligence  *(new — `media-pipeline.md` §5)*

| Feature | Description | Output |
|---------|-------------|--------|
| Voice Direction | Narration markup: pacing, pauses, emphasis | Per-section VoiceSpec |
| AI Narration | In-app TTS per script section (parallel jobs) | Voice takes w/ word timestamps |
| Voice Profiles | Consistent channel voice; consented voice cloning | Voice profile |
| Section Re-record | Regenerate a single section's narration | New take version |

Guardrails: clone only the creator's own consented voice (consent artifact stored); synthetic voice feeds disclosure flags.

---

## 8. Video & Image Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Scene Planning / Storyboarding / Shot Sequencing | Break script into scenes and shots | Scene plan, storyboard, shot list |
| Video Prompt Generation + Generation | Provider-ready prompts and in-app clip generation | Video clip assets |
| B-roll Image Briefs + Generation *(new)* | Per-scene stills/diagrams/backgrounds in brand style | Image assets (candidates per scene) |
| Production Workflow | Step-by-step generation checklist | Workflow |

Guardrail: provenance + provider ToS compliance recorded per asset; no third-party IP or identifiable faces without rights.

---

## 9. Subtitles  *(new — `media-pipeline.md` §7)*

| Feature | Description | Output |
|---------|-------------|--------|
| Subtitle Generation | Cues from script + voice timestamps (drift-free) | SRT/VTT + styled JSON |
| Styling | Brand-kit typography for burn-in | Styled cues |
| Cue Editing | Inline editing with reading-speed guards | Updated version |
| Multi-language | Per-locale translations (1:1 cue mapping) | Locale versions |

Guardrail: translations may not introduce claims absent from the fact-checked source.

---

## 10. Editor & Render  *(new — `video-editor.md`, `media-pipeline.md` §8)*

| Feature | Description | Output |
|---------|-------------|--------|
| AI First Cut | EditPlanAgent assembles a full timeline from script + assets | Timeline v1 |
| Timeline Editing | Multi-track drag & drop, trim, split, snap | Timeline |
| Effects & Transitions | Closed versioned catalog (crossfade, wipes, Ken-Burns, ducking, keyframes…) | Applied effects |
| Real-time Preview | Client-side proxy compositing + exact draft renders | Preview |
| Undo/Redo + Autosave | Command-pattern history; 2 s-debounced saves | Safety |
| Version History | Frozen timeline versions; non-destructive restore | Versions |
| Keyboard Shortcuts | Full editing shortcut set | Productivity |
| Rendering | Deterministic FFmpeg presets (proxy/1080p/4K/Shorts) | Render asset |
| Local + Cloud Save | Signed-URL download + R2 retention | Files |

Guardrails: editing/rendering only on compliance-passed projects; new renders after approval reset approval (WF-7b).

---

## 11. Thumbnail Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| Thumbnail Generation | Concept + image prompts + in-app generation | Thumbnail assets |
| A/B Testing | Compare variants | Variant set |
| CTR Optimization | Predict & improve click appeal | CTR prediction |

Guardrail: no misleading imagery; no third-party IP/faces without rights.

---

## 12. Publishing

| Feature | Description | Output |
|---------|-------------|--------|
| YouTube Upload | Direct upload of the pinned render via Data API | Video ID |
| Scheduling | Schedule future publish | Scheduled job |
| Metadata Publishing | Apply title/desc/tags/chapters | Applied metadata |
| Thumbnail Publishing | Set custom thumbnail | Applied thumbnail |
| Disclosure Application | Apply AI/altered-content disclosures | Disclosure set |

Hard precondition: compliance pass + human approval + matching bundle hash. See `youtube-publishing.md`.

---

## 13. Analytics Intelligence

| Feature | Description | Output |
|---------|-------------|--------|
| CTR / Retention / Watch Time / Revenue / Subscriber Analysis | Diagnostics tied to specific metrics | Insights |
| Retention-on-Script Overlay | Drop-offs mapped to timeline section markers | Section diagnosis |
| Growth Report | Consolidated diagnosis | Report |
| Optimization Suggestions | Concrete next actions | Action list |
| Next Video Recommendations | Topic ideas from data → channel memory | Topic seeds |

---

## Cross-Cutting Platform Features

- **Channel & Project Management:** connect YouTube channels (OAuth), organize work into projects, pipeline state tracking.
- **Voice Profiles & Brand Kit:** tone/style for scripts + narration; colors, fonts, thumbnail style, overlay templates reused across assets and the editor.
- **Asset Library:** all media in R2 with **version history** and write-once provenance; restore any version.
- **Job/Progress Center:** live status of queued generation/render jobs (WS/SSE), with streaming script output.
- **Budget & Usage Meter:** real-time spend vs plan limits (tokens, voice seconds, images, video/music credits, render minutes); cost shown before every paid action.
- **Approval Center:** human checkpoints surfaced for review/sign-off.
- **Semantic Channel Memory:** distilled per-channel learnings bias future recommendations honestly (`token-optimization.md` §7).
- **Team & Roles (Beta+):** RBAC for multi-user teams and agencies.
- **Audit Log:** every publish, edit, render, and compliance decision is logged.
- **Notifications:** email/in-app for job completion, approvals, publish results, budget warnings.
- **Multi-language:** script/metadata/subtitle localization (roadmap M4 for full per-region SEO).
- **Accessibility:** WCAG AA across the app including the editor (`uiux.md` §7).
