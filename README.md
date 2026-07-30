# Portable Anima Studio

Portable Anima Studio is a local UI for the Anima + Instant Reference LoRA
workflow. It owns a sanitized, versioned ComfyUI API template, so generation
does not depend on a saved ComfyUI workflow or history entry.

## What it provides

- Managed ComfyUI installation, start/stop/restart/repair, and searchable logs
- An external ComfyUI mode that never controls or modifies the external process
- Multiple reference images with durable job, event, preview, and output history
- Model, CLIP, VAE, LoRA, seed, sampler, scheduler, size, and upscale controls
- Live queue phase, exact sampling progress, denoise previews, and cancellation
- One-click same-seed upscale for a completed base-only generation
- Offline Danbooru tag completion and optional LoRA Manager metadata
- Civitai model inspection and verified managed-library downloads
- Reusable character profiles and model/LoRA configuration packs
- Final-prompt inspection with source labels, duplicate detection, and conflicts
- Up to 16 prompt/seed variations submitted as one tracked batch
- Result actions, representative images, and side-by-side result comparison
- First-run guidance, dependency remedies, VRAM/time estimates, and completion
  notifications
- Dependency-aware storage cleanup and portable JSON import/export

## Studio workflow

The Create screen follows **reference images → prompt → model/LoRA → generation
settings → result**. A character profile stores its ordered reference images,
prompt fields, Instant Reference settings, excluded tags, cache metadata, and an
optional representative result. Applying a profile does not replace the current
base model or sampling settings.

A model pack stores the diffusion model, CLIP, VAE, and ordered LoRA stack.
Applying a model pack does not replace references or prompts. Saved selections
are checked against the connected ComfyUI installation before generation.

The prompt inspector shows each positive and negative source separately and
previews the final ordering used by the server. It flags duplicates and common
positive/negative conflicts without silently rewriting the user's text.

The variation matrix creates at most 16 jobs from explicit prompt and seed
combinations. All combinations are validated before any job is queued. Completed
results can be repeated with the same settings, rerun with a new seed, reopened
for prompt editing, marked as a character representative, compared side by
side, or sent through the existing same-seed upscale path.

## Runtime modes

### Managed ComfyUI

Managed mode is the default for a new database. In **Settings → Runtime**, use
**Install** once and then **Start**. The app downloads pinned, hash-verified
copies of ComfyUI, standalone Python 3.12, uv, 7zr, the required custom nodes,
the Instant Reference training runtime, and the WD14 tagger. System Python, Git,
and a separate ComfyUI installation are not required.

The first managed-runtime release supports only:

- Windows x64
- An NVIDIA GPU and a working NVIDIA driver
- At least 25 GiB of free space for runtime installation
- Internet access during installation and Civitai downloads

Diffusion models, text encoders, VAEs, and LoRAs are **not bundled**. Install or
copy them separately after the runtime is ready.

Managed ComfyUI listens only on `127.0.0.1`. The app records the PID,
executable, command line, start identity, and session before it will terminate a
process. A PID that no longer matches is never killed. Normal stop is blocked
while app jobs are active; forced stop interrupts ComfyUI first.

`Auto start` controls whether a ready managed installation starts with the API.
`Stop with API` defaults to enabled. When disabled, API shutdown releases its
own resources but leaves the verified managed ComfyUI process running. External
processes are never stopped under either setting.

Repair always moves the current release to a recoverable quarantine directory
and reinstalls it, even if its marker is valid, so missing or damaged files are
actually restored. User models and inputs live in shared directories outside a
versioned release.

### External ComfyUI

External mode is for an existing ComfyUI installation. Set `COMFY_URL` before
the first start or choose the mode and URL in Settings. The app only makes
ComfyUI HTTP/WebSocket requests: it does not install files, start, stop,
restart, repair, or otherwise manage the external process.

Install these node contracts in the external ComfyUI environment:

| Package | Repository | Required node contract |
| --- | --- | --- |
| Instant Reference | https://github.com/cstria0106/comfyui-instant-reference | `InstantReferenceLoRA`, `ReferenceTaggingOptions`, `ReferenceTrainOptions` |
| ComfyUI-KJNodes | https://github.com/kijai/ComfyUI-KJNodes | `ScheduledCFGGuidance` |
| LoRA Manager | https://github.com/willmiao/ComfyUI-Lora-Manager | `Lora Stacker (LoraManager)` |
| LoRA Optimizer | https://github.com/ethanfel/ComfyUI-LoRA-Optimizer | `LoRAOptimizerSimple` |

The setup screen inspects the live `/object_info` input/output contract rather
than trusting package version numbers. Missing nodes and models are reported
separately. Switching away from managed mode requires stopping its process
first.

## Local setup

[Bun](https://bun.sh/) 1.3 or newer is required to run this workspace.

```powershell
bun install
Copy-Item .env.example .env
bun run db:migrate
bun run dev
```

Open `http://127.0.0.1:3000`. The API listens on
`http://127.0.0.1:8787`. Both services bind to localhost and have no
authentication, so they are not intended for network exposure.

For an existing ComfyUI, uncomment `COMFY_URL` in `.env` before the first API
start. Leave it unset for a new managed installation.

## Models and Civitai

Managed model directories are under:

```text
RUNTIME_DIR/shared/models/
  checkpoints/
  diffusion_models/
  unet/
  text_encoders/
  clip/
  vae/
  loras/
```

The Library can inspect HTTPS model-page URLs from `civitai.com` and
`civitai.red`. API URLs, direct download URLs, arbitrary hosts, credentials,
fragments, and unrelated query parameters are rejected. Downloads are limited
to LoRA or checkpoint model types and regular `.safetensors` files. The server
restricts destinations to its configured managed model roots, rejects symlinks
and path escapes, and verifies the final SHA-256 before indexing the file.

Managed downloads require managed mode with ComfyUI installed and ready.
External-mode downloads are intentionally disabled; external files and LoRA
Manager routes are not modified or exposed by the app. Downloads support
progress history and pause, resume, cancel, and retry where the underlying
transfer permits it.

The Civitai token field is write-only. On Windows it is encrypted with DPAPI for
the current user and is never returned by the API or stored in plaintext in
SQLite, settings JSON, or logs. Token changes affect direct metadata requests
immediately, but managed LoRA Manager reads its credential at process startup;
restart managed ComfyUI after adding, changing, or removing a token before
starting a managed download. Do not put the token in `.env`.

Civitai content and model licenses remain the user's responsibility. Sensitive
previews can be blurred in the Library.

## Tag data

The complete 183,174-row Danbooru tag CSV and a portable 110,284-row
cooccurrence index are checked into `packages/tag-data/data`. The first API
start imports them into SQLite FTS; later starts compare the stored source
fingerprint and skip unchanged data. Danbooru underscores are displayed as
spaces, while canonical aliases remain searchable.

To replace the data with a compatible `comfyui-autocomplete-plus` release, set
`DANBOORU_TAGS_CSV`, `DANBOORU_COOCCURRENCE_CSV`, and optionally
`DANBOORU_TAG_DATA_MANIFEST`. Paths may be absolute or repository-relative.
Restart the API to fingerprint and import the replacement. The old index is
kept if an import fails.

## Data, workflow, and progress

SQLite, encrypted secrets, uploaded references, copied outputs, and previews
live under `DATA_DIR`. The managed engine, shared model/input/output folders,
downloads, logs, quarantined releases, and caches live under `RUNTIME_DIR`.
Neither location is automatically deleted.

ComfyUI receives generated API prompts and uploaded inputs, while the app keeps
its own settings snapshot, actual seed, events, and output copy. Deleting a
ComfyUI workflow JSON, clearing ComfyUI history, or cleaning its output folder
does not remove the app's workflow definition or saved thumbnails.

Sampling progress uses ComfyUI's exact `value / max` events. Binary denoise
previews replace one per-job preview file rather than accumulating frames.
Instant Reference does not expose individual training steps, so that phase
shows activity and elapsed time rather than a fabricated percentage.

When the original run had upscale disabled, **동일 시드로 업스케일** creates a
child job from the preserved base output and actual seed. It runs only
`LoadImage → VAEEncode → LatentUpscaleBy →` second sampling; the base sampler
does not run again.

## Setup guidance and storage

The first-run guide tracks five durable steps: studio tour, ComfyUI runtime,
models and required nodes, a character profile, and a successful test
generation. The dismissed/completed state is stored in SQLite, so it follows
the local studio rather than one browser tab. The dependency panel maps missing
ComfyUI class types to the pinned custom-node package and installation source.

Storage settings list individual uploaded assets, copied outputs, current
preview files, and managed model downloads with their sizes and dependencies.
Cleanup first performs a dry run. Only explicitly selected, dependency-free
regular files under the managed data/model roots can be deleted; referenced
profile images, representative results, upscale sources, active previews, and
models used by saved packs remain protected.

## Portable settings

Portable JSON exports selected character profiles and model packs. Referenced
images are embedded as Base64 and deduplicated by SHA-256. Tokens, runtime
credentials, ComfyUI history identifiers, and personal absolute paths are never
included.

Import validates the complete bundle and previews missing nodes, endpoints,
models, VAEs, CLIPs, and LoRAs before applying it. Import never starts ComfyUI
or queues a generation. Limits are 25 MiB per image, 64 MiB total decoded image
data, 128 assets, 100 profiles, 100 model packs, and 96 MiB for the JSON request.

## Third-party inventory

Every managed release contains:

- `THIRD_PARTY_NOTICES.md` with pinned upstream source, revision, license, and
  distributed artifact hash
- `runtime.cdx.json`, a CycloneDX 1.5 SBOM for the managed runtime artifacts

These files are stored under
`RUNTIME_DIR/releases/<bundle-id>/`. License files included by each upstream
archive remain authoritative.

## Commands

```powershell
bun run dev          # API and web UI with live reload
bun run build        # production builds
bun run typecheck    # all TypeScript projects
bun run test         # workflow, API, runtime, and UI-adjacent tests
bun run db:generate  # generate a Drizzle migration after schema changes
bun run db:migrate   # apply committed migrations
bun run start        # start the production API and Next server
```
