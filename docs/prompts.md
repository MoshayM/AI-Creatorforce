# prompts.md — AI CreatorForce

Prompts are versioned assets stored in `packages/prompts`, referenced by key (e.g., `script.longform@3`). Agents pull prompts by key at runtime; large prompts are never inlined in agent code. This enables A/B testing, rollback, and policy updates without code deploys. Read alongside [agents.md](agents.md) and [architecture.md](architecture.md).

---

## 1. Principles

- **Versioned.** Every prompt has a key, an integer version, and an active flag. Changes ship as new versions; the prior version is preserved for rollback and comparison.
- **Auditable.** Prompt changes are reviewed changes, the same as code changes. Changing a version is a deliberate, tracked action.
- **Decoupled.** Agents reference a prompt key, not a literal string. This separates model behavior from agent orchestration logic.
- **Structured output first.** Prompts request output matching the agent's Zod schema (typically JSON-only, no prose, no markdown fences). Output is validated; on failure, retry or escalate.
- **Compliance baked in.** Content prompts require original phrasing, sourced claims, and forbid copyrighted reproduction and deceptive tactics. These constraints are not optional and must not be weakened to improve apparent "creativity."

---

## 2. Storage

**Build-time source:** `packages/prompts/src/`

- `index.ts` — prompt registry and lookup function.
- `templates/compliance.ts` — compliance audit prompt template.
- Additional templates per agent (in progress; see §8).

**Runtime source:** `PromptVersion` DB model.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Primary key |
| `key` | string | Prompt key, e.g. `compliance.audit` |
| `version` | integer | Monotonically increasing |
| `body` | text | Full prompt text |
| `active` | boolean | Only one active version per key at a time |
| `createdAt` | timestamp | — |

Unique constraint on `[key, version]`. Index on `[key, active]`. The `packages/prompts/src/` source and the DB rows must stay in sync. The DB is the authoritative runtime source; the source files are the canonical authoring location.

---

## 3. Key Format

```
<agent>.<task>@<version>
```

Examples:
- `compliance.audit@1`
- `script.longform@3`
- `research.web@2`
- `factcheck.verify@1`

Agents pass this key to the prompt registry lookup, which resolves the active version from the DB (or build-time registry as a fallback during local development).

---

## 4. Prompt Engineering Rules

Follow these rules for every new or modified prompt:

1. Start with a role declaration: `"You are a [specific role] for AI CreatorForce..."`
2. Enumerate the output format explicitly — field names, types, and any allowed enum values. Do not leave the model to infer structure.
3. For structured outputs: instruct the model to output **only** valid JSON with no markdown fences and no surrounding prose.
4. Include explicit enum values for category, severity, and status fields to prevent the model from hallucinating variant names.
5. Cite applicable constraints inline: YouTube policy, advertiser-friendliness requirements, fact-sourcing requirements.
6. Never put user-supplied content in the system prompt. User content belongs in the human turn, delimited as untrusted data.
7. Use temperature 0 for deterministic tasks (compliance, fact-check, metadata). Allow temperature > 0 for creative tasks (script generation). Set `bypassCache: true` for any call where determinism is not required.
8. Keep prompts tight. Add few-shot examples only where they produce measurable quality improvement; measure token cost vs. benefit.

**Untrusted data handling (mandatory):**

Any external, user-supplied, or fetched content passed into a prompt must be wrapped and labeled:

```
<<<UNTRUSTED>>>
{content here}
<<<END UNTRUSTED>>>
```

The prompt must explicitly instruct the model to treat this block as data only and to ignore any instructions that appear inside it. This is the primary prompt-injection defense. See [security.md](security.md) for the full policy.

---

## 5. Output Contract Pattern

Every structured prompt ends with:

```
Return ONLY a JSON object matching this schema (no prose, no code fences):
{ ...schema... }
If you cannot comply, return { "error": "<reason>" }.
```

The agent's `callStructured()` call parses this against the Zod schema. On failure: retry with the validation error appended to the prompt. After `MAX_AGENT_RETRIES`: route to `QualityControlAgent`. Raw, unvalidated output is never returned to callers.

---

## 6. Currently Implemented Prompts

**`packages/prompts/src/`:**

| File | Prompt(s) | Notes |
|---|---|---|
| `templates/compliance.ts` | `compliance.audit@1` | Compliance audit prompt; system prompt is also referenced directly in `ComplianceService` |
| `index.ts` | Registry / lookup | Resolves key → active version body |

Several agents currently have system prompts inlined in agent code. These are targets for migration to `packages/prompts`. See §8.

---

## 7. Prompt Admin (Internal Ops)

The `ai-ops` module exposes super-admin endpoints to:
- Activate or deactivate a prompt version (switching the `active` flag).
- Update provider config (default model per agent, temperature, max tokens).

These operations do not require a code deploy. Only super-admins can perform them. All changes are logged.

---

## 8. Planned / Not Yet Implemented

| Item | Status |
|---|---|
| Full versioned prompt library for all 18 agents | In progress. Several agents (research, script, factcheck, metadata, seo, trend, audience, analytics, growth, quality-control, edit-plan, image, voice, music, video, subtitle) still have system prompts inlined in agent code. These must migrate to `packages/prompts` before those agents are considered production-ready. |
| Prompt A/B testing framework | Planned. Design intent: new version served to a traffic slice, evaluated against schema-validity rate and compliance accuracy on fixture sets, promoted only if it meets or exceeds the current version on safety metrics. |
