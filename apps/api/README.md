# Anima Studio API

The API is a Bun-hosted Hono service. It owns job submission and progress
tracking so the browser never needs direct access to ComfyUI.

## Runtime

The workspace scripts start this package automatically. To run it alone:

```bash
bun install
bun --cwd apps/api db:migrate
bun --cwd apps/api dev
```

The service listens on `127.0.0.1:8787` and applies the checked-in Drizzle
migrations at startup. Assets, downloaded outputs, and the SQLite database are
stored below the repository's `data` directory. Asset and generated-output
records use paths relative to that directory. Managed runtime sessions and
model installation records retain their app-owned absolute paths.

## API contract

### Runtime and health

- `GET /api/health`
- `GET /api/capabilities`
- `GET|PUT /api/comfy/runtime`
- `POST /api/comfy/runtime/install|update|repair`
- `POST /api/comfy/runtime/start|stop|restart`
- `GET /api/comfy/runtime/logs`
- `GET /api/comfy/runtime/logs/events` — SSE

### Operations, providers, and managed models

- `GET /api/operations`
- `GET /api/operations/:id`
- `GET /api/operations/:id/events` — SSE
- `GET /api/download-providers/civitai`
- `PUT|DELETE /api/download-providers/civitai/token`
- `GET /api/download-providers/huggingface/anima`
- `POST /api/model-installations/civitai/inspect`
- `POST /api/model-installations/civitai`
- `POST /api/model-installations/anima`
- `GET /api/model-installations/civitai/loras`
- `GET /api/model-installations/:id/events` — SSE
- `DELETE /api/model-installations/:id`

### Studio data and jobs

- `GET /api/options`
- `GET /api/tags?q=red+eyes`
- `GET /api/tags?q=white&context=1girl,red+eyes` — retains the `{ tags }`
  envelope, ranks matching tags by cooccurrence, and additionally returns
  `related` plus source/query/context metadata. `related=` is accepted as a
  compatibility alias for `context=`.
- `GET /api/lora-thumbnail`
- `POST /api/assets` — multipart form field `files`, one or many images;
  returns `{ "assets": AssetDto[] }`
- `GET /api/assets/:id`
- `GET /api/outputs/:id`
- `GET /api/storage`
- `POST /api/storage/cleanup`
- `POST /api/jobs` — JSON `{ "config": GenerationConfig }`
- `GET /api/jobs`
- `GET|DELETE /api/jobs/:id`
- `GET /api/jobs/:id/preview` — latest in-memory denoise preview, served with
  `Cache-Control: no-store`
- `GET /api/jobs/:id/events` — SSE; supports `Last-Event-ID` and `?after=`
- `POST /api/jobs/:id/upscale` — starts an upscale-only child job for a
  completed base-only generation; optional JSON
  `{ "outputId": "...", "upscale": { "scale": 1.5 } }`
- `POST /api/jobs/:id/cancel`

Only PNG, JPEG, and WebP reference images are accepted. `GenerationConfig`
contains the ordered `referenceAssetIds` list.

## Progress and recovery

Each API process uses a unique ComfyUI client ID. WebSocket events are mapped
to the prompt ID returned by `POST /prompt`, translated to user-facing phases,
persisted in `job_events`, and then broadcast over SSE. Sampling events retain
the real `current`, `total`, and percentage values. ComfyUI preview event types
1 and 4 are supported, including prompt/node metadata negotiation. Only the
latest preview frame is retained in memory per active job and never written to
disk. Instant-reference training is
intentionally shown as an active phase without a fabricated percentage.

On startup, unfinished jobs are reconciled with ComfyUI `/queue` and
`/history/{promptId}`. Completed images and automatic tag text are copied into
the app data directory, so later ComfyUI history/output cleanup does not break
the Studio history.

## Tests

```bash
bun --cwd apps/api typecheck
bun --cwd apps/api test
```

The API tests use isolated SQLite databases plus injected fake ComfyUI and
workflow implementations. No running ComfyUI instance is required.
