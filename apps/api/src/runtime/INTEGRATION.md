# Managed runtime integration

`ManagedComfyRuntimeController` is the Hono-facing facade. Construct one
controller for the API process from:

- `resolveRuntimePaths(config.dataDir)`
- a transaction-backed `RuntimeStateRepository`
- `ManagedRuntimeInstaller`
- `ManagedRuntimeSupervisor`
- `RuntimeLogService`

The repository adapter is the persistence/event boundary. `patchState` should
upsert the singleton runtime row and `appendEvent` should insert the operation
event and publish it to the existing SSE broker. Its optional `subscribeEvents`
hook enables direct controller subscribers. Persisted runtime configuration is
authoritative; new databases default to `managed/not_installed`.

`controller.install(id)`, `update(id)`, and `repair(id)` return immediately.
Create the `OperationService` row first, then pass that exact caller-visible ID
to the controller so every installer event can reference an existing row. Use
`waitOperation` only from tests or shutdown logic, never in the request handler.
`start`, `stop`, and `restart` await the state transition.

Provide these production adapters to the supervisor:

- `RuntimeActiveJobProbe` backed by app jobs. Normal stop throws
  `RuntimeBusyError`; force stop performs Comfy interrupt/free first.
- `HttpRuntimeReadinessProbe` with `validateObjectInfo` calling the workflow
  package's live node-contract inspection and throwing when incompatible.

Startup recovery should call `controller.recover()` after DB migration. API
shutdown should await
`controller.close({ stopRuntime: runtimeConfig.stopWithApi })`. It always
cancels an in-flight installer and flushes logs. It stops ComfyUI only when the
flag is enabled and the process is a verified, app-owned managed process.
External processes are never terminated.

Suggested route mapping:

- `GET/PUT /api/comfy/runtime` → `status` / `configure`
- `POST .../install|update|repair` → immediate operation ID
- `POST .../start|stop|restart` → resulting runtime state
- `GET /api/operations/:id/events` → repository event rows/SSE
- `GET /api/comfy/runtime/logs` → `readLogs`
- log SSE → `tailLogs`

The installer writes `THIRD_PARTY_NOTICES.md`, `runtime.cdx.json`, and a
validated release marker. Civitai downloads and credentials are owned by the
API process and are never delegated to ComfyUI custom nodes.
