# AI CreatorForce web — Next.js App Router frontend.
# Build from the repo root (NEXT_PUBLIC_* are baked in at build time):
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 \
#     --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.com \
#     -t creatorforce/web:latest .

# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config ./packages/config
RUN pnpm install --frozen-lockfile --filter @cf/web... --filter @cf/shared...

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_USE_MOCK=false
RUN pnpm --filter @cf/shared build && pnpm --filter @cf/web build

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts ./apps/web/next.config.ts

RUN useradd -r -u 10001 creatorforce
USER creatorforce
WORKDIR /app/apps/web
EXPOSE 3007
CMD ["npx", "next", "start", "-p", "3007"]
