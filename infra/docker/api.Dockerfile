# AI CreatorForce API — NestJS + BullMQ workers (in-process) + media pipeline.
# Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t creatorforce/api:latest .

# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app

# Workspace manifests first — layer-cached installs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/config ./packages/config
RUN pnpm install --frozen-lockfile --filter @cf/api... --filter @cf/shared...

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @cf/shared build \
 && cd apps/api && npx prisma generate && npx nest build

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:24-slim
# ffmpeg for the render pipeline, yt-dlp for source imports. System binaries
# instead of ffmpeg-static: one arch-correct copy, referenced via env below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    YT_DLP_PATH=/usr/local/bin/yt-dlp \
    FACEFINDER_PATH=/app/assets/facefinder \
    MEDIA_STORAGE_DIR=/data/storage

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/assets ./assets

RUN useradd -r -u 10001 creatorforce && mkdir -p /data/storage && chown -R creatorforce /data/storage
USER creatorforce

WORKDIR /app/apps/api
EXPOSE 4007
# Migrations run as an initContainer/Job (prisma migrate deploy), not at boot.
CMD ["node", "dist/main.js"]
