# Deploying CreatorForce

CreatorForce is a **split deployment**: the Next.js frontend can run on Vercel, but the backend cannot. Read this before deploying.

## What runs where

| Part | Tech | Vercel? | Where it must run |
|---|---|---|---|
| `apps/web` | Next.js (App Router) | ✅ Yes | Vercel (or any Node host) |
| `apps/api` | NestJS long-lived HTTP server | ❌ No | Railway / Render / Fly.io / VPS |
| Workers | BullMQ consumers (SHORTS_ANALYZE, EDIT_RENDER, …) | ❌ No | Same host as the API (long-running process) |
| Database | PostgreSQL | ❌ No | Neon / Supabase / RDS / managed PG |
| Queue/cache | Redis | ❌ No | Upstash / managed Redis |
| Media | FFmpeg + persistent file storage | ❌ No | The API host's disk, or S3/R2 |

**Why the backend isn't Vercel-deployable:** Vercel runs stateless serverless functions with short timeouts and no persistent disk. The API is a persistent NestJS process; the workers are long-running BullMQ consumers that shell out to FFmpeg for multi-minute renders and write files to disk. None of that fits the serverless model. Deploy the API+workers on a container/VM host and point the frontend at it.

## Domain

Production domain: **`aicreatorforce.net`** (see the root `CNAME`). Point the apex + `www` at the frontend host. Suggested split:
- Frontend (Vercel): `aicreatorforce.net` and `www.aicreatorforce.net`
- API (separate host): a subdomain such as `api.aicreatorforce.net` → set `NEXT_PUBLIC_API_URL=https://api.aicreatorforce.net/api/v1` and `NEXT_PUBLIC_WS_URL=wss://api.aicreatorforce.net`.

The API already allows `https://aicreatorforce.net` and `https://www.aicreatorforce.net` as CORS origins (plus anything in `WEB_URL`, comma-separated).

## Frontend on Vercel (this is what `vercel.json` configures)

1. Push to GitHub (done — repo is `MoshayM/AI-Creatorforce`).
2. In Vercel: **New Project → import the repo**. `vercel.json` at the repo root sets the monorepo-aware build (`@cf/shared` is built before `@cf/web`), install command, and output dir — no "Root Directory" override needed.
3. Set environment variables (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_API_URL` = `https://<your-api-host>/api/v1`
   - `NEXT_PUBLIC_WS_URL` = `wss://<your-api-host>`
   - `NEXT_PUBLIC_USE_MOCK` = `false`
   - `SKIP_ENV_VALIDATION` = `true` (build-time)
   - `SENTRY_AUTH_TOKEN` (optional, only if using Sentry source maps)
4. Deploy. Vercel builds `apps/web` and serves it.
5. **CORS:** the API currently allows origin `http://localhost:3007` only (see `apps/api` bootstrap). Add your Vercel domain to the allowed origins before the deployed frontend can call the API.

## Backend + workers (example: Railway/Render)

1. Provision managed PostgreSQL and Redis; set `DATABASE_URL` and `REDIS_URL`.
2. Set required secrets: `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` (≥32 chars), AI keys (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`), Google OAuth creds.
3. Build: `pnpm install --frozen-lockfile && pnpm --filter @cf/shared build && pnpm --filter @cf/api build`.
4. Migrate: `pnpm --filter @cf/api exec prisma migrate deploy`.
5. Start: `node apps/api/dist/main.js` (this process runs both the HTTP API and the BullMQ workers). Ensure FFmpeg is available — `ffmpeg-static` is bundled as a dependency, so no system install is needed.
6. Point the Vercel frontend's `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` at this host and add the Vercel domain to the API's CORS allow-list.

## Note

The `vercel.json` here deploys the **frontend only**. It is safe to connect the repo to Vercel; Vercel will ignore `apps/api`. Nothing here triggers a backend deploy.
