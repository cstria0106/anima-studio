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

Environment variables:

- `COMFY_URL` defaults to `http://127.0.0.1:8188`.
- `API_PORT` defaults to `8787` (`PORT` remains a compatibility alias).
- `DATA_DIR` defaults to `<repository>/data`.
- `DATABASE_PATH` defaults to `<DATA_DIR>/anima-studio.sqlite`.
- `MAX_UPLOAD_BYTES` defaults to 25 MiB per image.
- `MAX_UPLOAD_BATCH_BYTES` defaults to 100 MiB per request.
- `MAX_IMAGE_DIMENSION` defaults to 16,384 pixels per side.
- `MAX_IMAGE_PIXELS` defaults to 100 million decoded pixels.
- `COMFY_REQUEST_TIMEOUT_MS` defaults to 15 seconds.
- `COMFY_QUEUE_POLL_MS` defaults to 3 seconds.
- `DANBOORU_TAGS_CSV` optionally replaces the repository-managed tag CSV.
- `DANBOORU_COOCCURRENCE_CSV` optionally replaces the repository-managed
  contextual-suggestion CSV.
- `DANBOORU_TAG_DATA_MANIFEST` optionally replaces the source fingerprint
  manifest.
- `DANBOORU_COOCCURRENCE_MIN_COUNT` defaults to `5000`.

The service applies the checked-in Drizzle migration at startup. Assets and
downloaded outputs are stored below `DATA_DIR`; the database stores relative
paths only.

## API contract

- `GET /api/health`
- `GET /api/capabilities`
- `GET /api/options`
- `GET /api/tags?q=red+eyes`
- `GET /api/tags?q=white&context=1girl,red+eyes` — retains the existing
  `{ tags }` envelope, ranks matching tags by cooccurrence, and additionally
  returns `related` plus source/query/context metadata. `related=` is accepted
  as a compatibility alias for `context=`.
- `POST /api/assets` — multipart form field `files`, one or many images;
  returns `{ "assets": AssetDto[] }`
- `GET /api/assets/:id`
- `POST /api/jobs` — JSON `{ "config": GenerationConfig }`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/preview` — latest denoise preview, replaced in place and
  served with `Cache-Control: no-store`
- `GET /api/jobs/:id/events` — SSE; supports `Last-Event-ID` and `?after=`
- `POST /api/jobs/:id/upscale` — starts an upscale-only child job for a
  completed base-only generation; optional JSON
  `{ "outputId": "...", "upscale": { "scale": 1.5 } }`
- `POST /api/jobs/:id/cancel`
- `GET /api/outputs/:id`

Only PNG, JPEG, and WebP reference images are accepted. `GenerationConfig`
contains the ordered `referenceAssetIds` list.

## Progress and recovery

Each API process uses a unique ComfyUI client ID. WebSocket events are mapped
to the prompt ID returned by `POST /prompt`, translated to user-facing phases,
persisted in `job_events`, and then broadcast over SSE. Sampling events retain
the real `current`, `total`, and percentage values. ComfyUI preview event types
1 and 4 are supported, including prompt/node metadata negotiation. Only the
latest preview frame is retained per job. Instant-reference training is
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
