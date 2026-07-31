# Personal Engineering Preferences

## Implementation

- Solve problems at their source instead of patching individual symptoms.
- Keep shared logic and data in one place. Reuse them instead of duplicating them.
- Remove obsolete code unless backward compatibility is explicitly required.
- Add validation, fallbacks, retries, or limits only for explicit requirements or observed failures.

## Tests

- Test observable behavior and public contracts rather than implementation details.
- Each assertion must verify a distinct behavior.
- Test absence only when absence is part of the contract.
- Verify internal cleanup with typechecking, linting, code search, and review rather than behavior tests.

## Toolchain

- Use the toolchain already established by the repository.
- Use Bun 1.3.14 for this monorepo.
- For new JavaScript or TypeScript projects, use `bun`.
- For new Python projects, use `uv`.

## Commits

- When explicitly asked to commit, use a short Conventional Commit message describing the change.

## Portable Release Invariants

- Treat the root `package.json` `version` as the only application and release version. A release tag must be exactly `v<package-version>`.
- Ship only `dist/AnimaStudio.exe`. Do not add an installer, code signing, a tray process, a native window, or automatic executable replacement unless the product scope explicitly changes.
- Keep all mutable packaged-app data at `join(dirname(process.execPath), "data")`. Do not introduce a configurable data directory, fixed server port, or LocalAppData fallback.
- Never include or modify the repository `data` directory, user databases, models, outputs, or managed runtime as part of a build.
- Keep the packaged HTTP server on `127.0.0.1` with port `0`. UI API and SSE calls must use same-origin relative `/api/...` URLs.
- Reuse `apps/api/src/process/windows.ts` for Windows process identity checks. Do not duplicate PID, executable-path, or process-start matching in the launcher or runtime supervisor.
- Preserve token-authenticated instance probing and token-checked lock cleanup when changing single-instance behavior.
- Do not install or download ComfyUI at application startup. Downloads begin only after an explicit user action such as **엔진 설치**.
- Treat `THIRD_PARTY_NOTICES.md` and packaged resource imports as generated build outputs. Change their generator scripts instead of hand-editing generated content.
- Rebuild the EXE after changing web assets, Drizzle migrations, tag data, dependencies, or the root version so embedded hashes and notices are refreshed.

## Release Verification

Run the following before handing off a Windows release:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run --cwd apps/web lint
bun run build
.\scripts\smoke-portable.ps1 -Executable .\dist\AnimaStudio.exe
```

The smoke test must use a clean directory containing only the EXE and verify `/`, `/api/health`, `/api/app/info`, the dynamic port in `instance.json`, the EXE-adjacent data path, and reuse of the existing URL by a second launch.
