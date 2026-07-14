# ZAP baseline scanning (docs4/23)

`plan.yaml` is an Automation Framework plan: spider + passive scan of the web
app, no active attacks (mirrors `zap-baseline.py`). CI runs it in the
`zap-baseline` job against a production `next start` on port 3007 and gates on
High-risk findings via `check-zap-summary.mjs` — Medium and below are reported
in the artifact but don't block (docs4/23: "High findings gate the pipeline").

Run locally (any JRE 17+; reports land next to the plan):

```
java -jar <zap>/zap-2.16.1.jar -cmd -silent -dir <scratch-dir> -autorun .zap/plan.yaml
```

(paths inside `plan.yaml` are the docker-mount ones — for a local run, copy the
plan and point `reportDir`/`summaryFile` somewhere writable.)

## Accepted findings (baseline 2026-07-14: 0 FAIL / 5 WARN / 52 PASS)

| Rule | Finding | Why accepted |
|---|---|---|
| 10055 | CSP: `script-src 'unsafe-eval'` | Dev-server only — `next.config.ts` adds `'unsafe-eval'` only when `NODE_ENV !== 'production'`. Absent in the CI scan (production build). |
| 10055 | CSP: `script-src 'unsafe-inline'` | Required by Next.js runtime bootstrap scripts. Tightening to nonces/hashes is tracked as a future hardening step. |
| 10027 | Suspicious comments in JS | Unminified dev chunks; production bundles are minified and stripped. |
| 10044 | Big redirect body | Next.js 307 redirect page for `/` → `/login`; body is the framework's redirect document, no sensitive data. |
| 10109 | Modern Web Application | Informational fingerprint, not a vulnerability. |

`X-Powered-By` (10037) was a real finding — fixed with `poweredByHeader: false`
in `apps/web/next.config.ts`.
