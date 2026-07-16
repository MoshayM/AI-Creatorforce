# Kubernetes Deployment — AI CreatorForce

Production-grade multi-instance deployment. Manifests live in `infra/k8s/`
(kustomize), container images in `infra/docker/`. This replaces the
single-host layout in [deployment.md](deployment.md) §4 when horizontal
scaling is needed.

---

## Architecture

```
                        ┌────────────────────────────────────────────┐
   Internet ──► Ingress │ nginx + cert-manager TLS (aicreatorforce.net)
                        └──────┬──────────────────────┬──────────────┘
                    /api, /socket.io                  /
                               │                      │
                     ┌─────────▼────────┐   ┌─────────▼────────┐
                     │ api  (Deployment │   │ web  (Deployment │
                     │ ×2→8, HPA @70%)  │   │ ×2→6, HPA @70%)  │
                     │ NestJS + BullMQ  │   │ Next.js          │
                     │ workers in-proc  │   └──────────────────┘
                     └──┬────┬────┬─────┘
                        │    │    │
          ┌─────────────▼┐ ┌─▼──────────┐ ┌▼───────────────────┐
          │ postgres     │ │ redis 7    │ │ cf-media PVC (RWX) │
          │ StatefulSet  │ │ queues +   │ │ renders/assets     │
          │ (or managed) │ │ rate limit │ │ shared across pods │
          └──────────────┘ │ + cache    │ └────────────────────┘
                           └────────────┘
```

**Why replicas > 1 is safe now** (each was a readiness-report finding, since fixed):
- Auth + dev-API rate limiting are Redis-backed (shared counters across pods).
- The compliance result cache has a Redis shared layer (no duplicate AI spend).
- BullMQ distributes agent jobs across all API pods via Redis.
- Webhook crediting is idempotent at both the event and payment level.

**The one constraint:** media files (renders, imported sources, thumbnails)
are on disk. `cf-media` must be a **ReadWriteMany** PVC (EFS, GCP Filestore,
Azure Files, or NFS) so any pod can serve any render. When Cloudflare R2
wiring lands (roadmap Phase 4), this PVC shrinks to a scratch cache.

## Build the images

```sh
docker build -f infra/docker/api.Dockerfile -t <registry>/creatorforce/api:v1 .
docker build -f infra/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://aicreatorforce.net/api/v1 \
  --build-arg NEXT_PUBLIC_WS_URL=wss://aicreatorforce.net \
  -t <registry>/creatorforce/web:v1 .
docker push <registry>/creatorforce/api:v1 <registry>/creatorforce/web:v1
```

The API image bundles ffmpeg, yt-dlp, and the face-tracking cascade
(`assets/facefinder`) — no init downloads at pod start.

## Deploy

```sh
# 1. Secrets (once per cluster) — copy the template, fill in real values
cp infra/k8s/secret.example.yaml infra/k8s/secret.yaml && $EDITOR infra/k8s/secret.yaml
kubectl apply -f infra/k8s/namespace.yaml -f infra/k8s/secret.yaml

# 2. Everything else
kubectl apply -k infra/k8s

# 3. Watch the rollout — the api initContainer runs prisma migrate deploy
kubectl -n creatorforce rollout status deploy/api deploy/web
```

Update images with `kubectl -n creatorforce set image deploy/api api=<registry>/creatorforce/api:v2`
(or a GitOps controller); the initContainer migrates before new pods serve.

## Probes and operations

| Concern | Where |
|---------|-------|
| Liveness | `GET /health` (process up) |
| Readiness | `GET /ready` (DB + Redis reachable) — pods drop from the Service when a dependency is down |
| Migrations | `initContainer: npx prisma migrate deploy` per rollout |
| Metrics | Prometheus scrape on `/metrics` (see `infra/monitoring/`) |
| Scaling | HPA on CPU 70% (api 2→8, web 2→6); renders are the CPU driver |
| Uploads/websockets | Ingress: 512 MB body, 1 h timeouts, cookie affinity for socket.io |

## Production checklist deltas

- Prefer managed Postgres over the bundled StatefulSet; delete `postgres.yaml`
  and point `DATABASE_URL` at it.
- `BILLING_ENFORCE_CREDITS=true` is set in the ConfigMap — production meters
  AI spend against wallets (local dev keeps it off).
- Run the go-live runbook (deployment.md §9): channel OAuth reconnect, ZAP
  baseline against the live URL, k6 load baseline.
- n8n and the Grafana/Prometheus stack from `docker-compose.yml` /
  `infra/monitoring/` are not yet expressed as manifests — add them when those
  components go to production (tracked in roadmap Phase 5).
