# Media Pipeline Placeholder Audit

> Deliverable for `ai-creatorforce-master-prompt.md` §11 step 1 (2026-07-06).
> Inventory of every path that lets a job reach COMPLETED without real, validated media.

## Severity A — fake media reaches COMPLETED

| # | Path | File | Produces | Trigger |
|---|------|------|----------|---------|
| A1 | OfflineVoiceAdapter | `apps/api/src/modules/media/adapters/voice-offline.adapter.ts` | 180 Hz sine hum modulated by word cadence (timing-accurate, no speech) | last in voice chain; fires whenever ElevenLabs/OpenAI keys missing or fail; `available()` always true |
| A2 | OfflineMusicAdapter | `.../music-offline.adapter.ts` | synthesized I–V–vi–IV chord pad WAV | ONLY adapter in the music chain — every music request is synthetic |
| A3 | OfflineImageAdapter | `.../image-offline.adapter.ts` | seeded vertical-gradient PNG | last in image chain; fires when Gemini/OpenAI fail |
| A4 | FfmpegSceneVideoAdapter | `.../video-ffmpeg.adapter.ts` | Ken Burns zoom over a still (real MP4, no generative motion) | ONLY adapter in the video chain |
| A5 | THUMBNAIL stage | `apps/api/src/workers/supervisor.worker.ts` (~line 337) | JSON brief only, `note: "actual image creation is Phase 2"` | every FULL_PRODUCTION run — stage COMPLETED with zero image asset |

All five mark assets `READY` / stages `COMPLETED`; the only disclosure is the
`provider`/`notes` provenance strings (`offline-cadence-synth`, `offline-gradient`, …).

## Severity B — fake progress / non-blocking validation

| # | Path | File | Problem |
|---|------|------|---------|
| B1 | Quality checks advisory-only | `apps/api/src/modules/media/quality.util.ts` + RENDER case | "No voice audio asset — video will render silent" is LOGGED, then render proceeds to COMPLETED. No post-render validation of the final MP4 at all. |
| B2 | RenderService.simulateRender | `apps/api/src/modules/render/render.service.ts:67-92` | timer-driven progress (setTimeout 3s/5s/5s), hardcoded 150 MB sizeBytes, checksum derived from the id, status READY with no file. Deprecated path but still callable. |
| B3 | MSW web mocks | `apps/web/src/mocks/handlers.ts` | test-only (MOCK_MODE) — acceptable, keep out of prod builds |

## Severity C — cosmetic

Phase-2 comments (`supervisor.worker.ts:354`, `publishing.service.ts:36`) and
placeholder-related comments in adapters/codec.util — documentation, no runtime impact.

## Adapter chains (fallback order)

- voice: ElevenLabs → OpenAI TTS → **OfflineVoice (always succeeds, fake)**
- image: Gemini → OpenAI → **OfflineImage (always succeeds, fake)**
- music: **OfflineMusic only (always fake)**
- video: **FfmpegSceneVideo only (Ken Burns, non-generative)**

## Remediation (implemented after this audit)

1. **Validation Engine** (`media-validation.util.ts`): ffmpeg-based checks —
   existence/size, decode-ability, duration tolerance, audio silence scan
   (volumedetect), black-frame scan (blackdetect). Stage completion is gated
   on passing; failures retry the stage once, then mark FAILED. Never COMPLETED.
2. **Offline adapters opt-in only**: `ALLOW_OFFLINE_MEDIA=true` enables them for
   keyless local dev; default off → a stage with no real provider FAILS with a
   configure-provider message instead of fabricating output.
3. **THUMBNAIL generates a real image** through the image adapter chain and
   validates it; the brief remains as the prompt input, not the deliverable.
4. **simulateRender removed** — the Render API routes to the real RENDER job.
5. Ken Burns stays as the documented last-resort video fallback (it is real,
   validated footage) until generative providers are configured; provenance
   marks it `ffmpeg-kenburns` and the render result surfaces that note.
