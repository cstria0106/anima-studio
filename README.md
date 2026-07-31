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
- Offline Danbooru tag completion and Civitai LoRA metadata
- Official Hugging Face Anima catalog and verified managed-library downloads
- Civitai model inspection and verified managed-library downloads
- Final-prompt inspection with source labels, duplicate detection, and conflicts
- History-based settings restoration, zoomable results, and side-by-side comparison
- First-run guidance, dependency remedies, measured hardware status, and
  completion notifications
- Dependency-aware storage cleanup

## Studio workflow

Create remains the main screen, with a two-column History rail on wide
displays. References, the main prompts, size, batch, seed, steps, and CFG stay
visible; less frequently changed model, sampler, Instant Reference, tagging,
upscale, and advanced prompt fields are collapsible.

Reference images are ordered by SHA-256 before settings are saved, inputs are
uploaded, and a workflow is built. A completed History entry preserves the
complete generation settings, actual seed, references, and outputs, and can
restore those settings directly into Create.

The prompt inspector shows each positive and negative source separately and
previews the final ordering used by the server. It flags duplicates and common
positive/negative conflicts without silently rewriting the user's text.

Completed results can be repeated with the same settings, rerun with a new
seed, reopened for prompt editing, compared side by side, zoomed, downloaded,
or sent through the existing same-seed upscale path.

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
- Internet access during installation and model downloads

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

External mode is for an existing ComfyUI installation. Choose the mode and URL
under Settings > Engine. The app only makes ComfyUI HTTP/WebSocket requests: it
does not install files, start, stop, restart, repair, or otherwise manage the
external process.

Install these node contracts in the external ComfyUI environment:

| Package | Repository | Required node contract |
| --- | --- | --- |
| Instant Reference | https://github.com/cstria0106/comfyui-instant-reference | `InstantReferenceLoRA`, `ReferenceTaggingOptions`, `ReferenceTrainOptions` |
| ComfyUI-KJNodes | https://github.com/kijai/ComfyUI-KJNodes | `ScheduledCFGGuidance` |
| LoRA Optimizer | https://github.com/ethanfel/ComfyUI-LoRA-Optimizer | `LoRAOptimizerSimple` |

The setup screen inspects the live `/object_info` input/output contract rather
than trusting package version numbers. Missing nodes and models are reported
separately. Switching away from managed mode requires stopping its process
first.

## Local setup

[Bun](https://bun.sh/) 1.3 or newer is required to run this workspace.

```powershell
bun install
bun run db:migrate
bun run dev
```

Open `http://127.0.0.1:3000`. The API listens on
`http://127.0.0.1:8787`. Both services bind to localhost and have no
authentication, so they are not intended for network exposure.

For an existing ComfyUI, select External and enter its URL under Settings >
Engine. New installations use the managed engine by default.

## Models and downloads

Managed model directories are under:

```text
data/runtime/shared/models/
  checkpoints/
  diffusion_models/
  unet/
  text_encoders/
  clip/
  vae/
  loras/
```

### Official Anima models from Hugging Face

The Library reads the public
[`circlestone-labs/Anima`](https://huggingface.co/circlestone-labs/Anima)
repository and offers its supported diffusion models as one-click managed
installs. This provider is deliberately limited to that repository and to
regular Git LFS `.safetensors` files under its `diffusion_models`,
`text_encoders`, and `vae` directories. Arbitrary Hugging Face repositories or
download URLs are not accepted.

Downloads are available only in managed runtime mode. They never write to an
external ComfyUI installation. Files are placed according to their ComfyUI
model type:

```text
data/runtime/shared/models/diffusion_models/<Anima model>.safetensors
data/runtime/shared/models/text_encoders/qwen_3_06b_base.safetensors
data/runtime/shared/models/vae/qwen_image_vae.safetensors
```

Selecting an Anima diffusion model also installs the shared Qwen text encoder
and Qwen Image VAE when they are not already present. At the repository revision
documented during development, one diffusion model is about 3.90 GiB and a
first complete model set is about 5.24 GiB. The Library confirmation dialog
shows the current exact transfer size. Ensure adequate free space and expect a
long download on slower connections.

The catalog request uses these local API endpoints:

```text
GET  /api/download-providers/huggingface/anima
POST /api/model-installations/anima
DELETE /api/model-installations/<installation-id>
GET  /api/model-installations/<installation-id>/events
```

The `GET` response supplies the revision and allowed file paths used by the
`POST` request:

```json
{
  "revision": "<40-character catalog SHA>",
  "path": "split_files/diffusion_models/anima-turbo-v1.0.safetensors",
  "includeDependencies": true,
  "acceptedLicense": true
}
```

The server resolves the current repository SHA with the official Hugging Face
model API at
`https://huggingface.co/api/models/circlestone-labs/Anima`, then reads
`/api/models/circlestone-labs/Anima/tree/<sha>?recursive=true&expand=true` at
that immutable 40-character revision.
Every transfer uses a revision-pinned `resolve/<sha>/<path>` URL and is accepted
only when its byte size and Git LFS SHA-256 match the pinned catalog. A matching
installed file is reused; a same-name file with different content is not
overwritten. The Library exposes only install, installing progress, and remove
states. Completed installations are stored in the managed installation
registry; transient transfer and operation records are removed after success or
failure.

The weights are distributed under the
[CircleStone Labs Non-Commercial License](https://huggingface.co/circlestone-labs/Anima/blob/main/LICENSE.md).
The Library requires explicit acknowledgment before queueing an install. Model
and derivative-model use is restricted to the license's non-commercial terms;
the license describes generated-output rights separately. Review the
revision-pinned license link shown in the confirmation dialog before use.

### Civitai

The Library can inspect HTTPS model-page URLs from `civitai.com` and
`civitai.red`. API URLs, direct download URLs, arbitrary hosts, credentials,
fragments, and unrelated query parameters are rejected. Downloads are limited
to LoRA or checkpoint model types and regular `.safetensors` files. The server
restricts destinations to its configured managed model roots, rejects symlinks
and path escapes, and verifies the final SHA-256 before indexing the file.

Managed installs require managed mode. The API downloads directly into the
app-owned model directory with resumable HTTP transfers, progress controls,
size checks, and SHA-256 verification; ComfyUI does not need to be running.
External-mode installs are intentionally disabled. The Library shows only
install, installing progress, and remove states.

The Civitai token field is write-only. On Windows it is encrypted with DPAPI for
the current user and is never returned by the API or stored in plaintext in
SQLite, settings JSON, ComfyUI, or logs. Token changes affect metadata and
downloads immediately and do not require restarting ComfyUI.

Civitai content and model licenses remain the user's responsibility. Sensitive
previews can be blurred in the Library.

## Tag data

The complete 183,174-row Danbooru tag CSV and a portable 110,284-row
cooccurrence index are checked into `packages/tag-data/data`. The first API
start imports them into SQLite FTS; later starts compare the stored source
fingerprint and skip unchanged data. Danbooru underscores are displayed as
spaces, while canonical aliases remain searchable.

To replace the data with a compatible `comfyui-autocomplete-plus` release,
rebuild the portable files using the scripts documented in
`packages/tag-data/data/README.md` and commit them with the updated manifest.
The old index is kept if an import fails.

## Data, workflow, and progress

SQLite, encrypted secrets, uploaded references, and copied outputs live under
`data`. The managed engine, shared model/input/output folders, downloads, logs,
quarantined releases, and caches live under `data/runtime`. Neither location is
automatically deleted.

ComfyUI receives generated API prompts and uploaded inputs, while the app keeps
its own settings snapshot, actual seed, events, and output copy. Deleting a
ComfyUI workflow JSON, clearing ComfyUI history, or cleaning its output folder
does not remove the app's workflow definition or saved thumbnails.

Sampling progress uses ComfyUI's exact `value / max` events. Binary denoise
previews keep only the latest frame in process memory and are released when the
job ends. Preview frames are not written to disk.
Instant Reference does not expose individual training steps, so that phase
shows activity and elapsed time rather than a fabricated percentage.

When the original run had upscale disabled, **동일 시드로 업스케일** creates a
child job from the preserved base output and actual seed. It runs only
`LoadImage → VAEEncode → LatentUpscaleBy →` second sampling; the base sampler
does not run again.

## Setup guidance and storage

The first-run guide tracks four durable steps: studio tour, ComfyUI runtime,
models and required nodes, and a successful test generation. The
dismissed/completed state is stored in SQLite, so it follows the local studio
rather than one browser tab. The dependency panel maps missing ComfyUI class
types to the pinned custom-node package and installation source.

Storage settings show counts and disk usage for uploaded assets, copied
outputs, and managed model installations. Managed models are installed and
removed from Library.

## Third-party inventory

Every managed release contains:

- `THIRD_PARTY_NOTICES.md` with pinned upstream source, revision, license, and
  distributed artifact hash
- `runtime.cdx.json`, a CycloneDX 1.5 SBOM for the managed runtime artifacts

These files are stored under
`data/runtime/releases/<bundle-id>/`. License files included by each upstream
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
