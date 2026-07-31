import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  EngineManifest,
  RuntimePaths,
} from "@anima/runtime";

export interface RuntimeProvisionContext {
  manifest: EngineManifest;
  releaseRoot: string;
  paths: RuntimePaths;
  signal?: AbortSignal;
  onLog?(message: string): void;
}

export interface RuntimeProvisioner {
  provision(context: RuntimeProvisionContext): Promise<void>;
}

export class NoopRuntimeProvisioner implements RuntimeProvisioner {
  provision(): Promise<void> {
    return Promise.resolve();
  }
}

export const MANAGED_INSTANT_REFERENCE_SETUP_VERSION = "13";
const INSTANT_REFERENCE_BUNDLE_KEY_LENGTH = 12;

const ALLOWED_CUSTOM_NODE_DIRECTORIES = new Set([
  "comfyui-instant-reference",
  "ComfyUI-KJNodes",
  "ComfyUI-LoRA-Optimizer",
]);

export async function validateManagedCustomNodeAllowlist(
  releaseRoot: string,
): Promise<void> {
  const directory = join(releaseRoot, "ComfyUI", "custom_nodes");
  const unexpected = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "__pycache__" &&
        !ALLOWED_CUSTOM_NODE_DIRECTORIES.has(entry.name),
    )
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `Managed runtime contains non-allowlisted custom nodes: ${unexpected.join(", ")}.`,
    );
  }
}

function replaceOne(
  source: string,
  expression: RegExp,
  replacement: string,
  label: string,
): string {
  const matches = source.match(new RegExp(expression.source, expression.flags));
  if (!matches) {
    throw new Error(`Instant Reference patch anchor is missing: ${label}.`);
  }
  const result = source.replace(expression, replacement);
  if (result === source) {
    throw new Error(`Instant Reference patch made no change: ${label}.`);
  }
  return result;
}

/**
 * Removes all implicit Git/pip bootstrap paths from the pinned Instant
 * Reference runtime. The installer supplies Python, uv and sd-scripts instead.
 */
export function patchInstantReferenceRuntimeSource(source: string): string {
  let result = replaceOne(
    source,
    /^SETUP_VERSION = "12"$/m,
    `SETUP_VERSION = "${MANAGED_INSTANT_REFERENCE_SETUP_VERSION}"`,
    "setup version",
  );
  result = replaceOne(
    result,
    /def runtime_root\(\) -> Path:\r?\n    return plugin_root\(\) \/ "runtime"/,
    [
      "def runtime_root() -> Path:",
      '    managed_root = os.environ.get("INSTANT_REFERENCE_RUNTIME_DIR")',
      "    if managed_root:",
      "        return Path(managed_root).resolve()",
      '    return plugin_root() / "runtime"',
    ].join("\n"),
    "runtime_root",
  );
  result = replaceOne(
    result,
    /def ensure_uv\(paths: RuntimePaths, log_path: Path \| None = None\) -> str:[\s\S]*?(?=\r?\ndef runtime_project_dir)/,
    [
      "def ensure_uv(paths: RuntimePaths, log_path: Path | None = None) -> str:",
      "    uv = uv_executable()",
      "    if uv is None:",
      "        raise RuntimeError(",
      '            "Managed Instant Reference uv is missing. Repair the Anima runtime."',
      "        )",
      "    return uv",
      "",
    ].join("\n"),
    "ensure_uv",
  );
  result = replaceOne(
    result,
    /def resolve_runtime_python\(\) -> str:[\s\S]*?(?=\r?\ndef runtime_imports_ready)/,
    [
      "def resolve_runtime_python() -> str:",
      '    managed_python = os.environ.get("INSTANT_REFERENCE_PYTHON")',
      "    if managed_python and Path(managed_python).exists():",
      "        if python_version_tuple(managed_python) == (3, 12):",
      "            return managed_python",
      '        raise RuntimeError("Managed Instant Reference Python must be 3.12.")',
      '    raise RuntimeError("Managed Instant Reference Python is missing. Repair the Anima runtime.")',
      "",
    ].join("\n"),
    "resolve_runtime_python",
  );
  result = replaceOne(
    result,
    /def ensure_sd_scripts_checkout\(paths: RuntimePaths, log_path: Path \| None = None\) -> None:[\s\S]*?(?=\r?\ndef ensure_sd_scripts_environment)/,
    [
      "def ensure_sd_scripts_checkout(paths: RuntimePaths, log_path: Path | None = None) -> None:",
      "    if not paths.sd_scripts.exists():",
      '        raise RuntimeError("Managed sd-scripts are missing. Repair the Anima runtime.")',
      "",
    ].join("\n"),
    "ensure_sd_scripts_checkout",
  );
  result = replaceOne(
    result,
    /(\[\s*\r?\n\s*uv,\s*\r?\n\s*"sync",)/,
    '$1\n            "--frozen",',
    "uv sync --frozen",
  );
  return result;
}

export function managedInstantReferenceRuntimeRoot(
  paths: RuntimePaths,
  bundleId: string,
): string {
  const bundleKey = createHash("sha256")
    .update(bundleId, "utf8")
    .digest("hex")
    .slice(0, INSTANT_REFERENCE_BUNDLE_KEY_LENGTH);
  return join(paths.root, "ir", bundleKey);
}

export function managedInstantReferenceUvCacheRoot(
  paths: RuntimePaths,
  bundleId: string,
): string {
  return join(managedInstantReferenceRuntimeRoot(paths, bundleId), "uv");
}

export function managedInstantReferenceUvEnvironment(
  paths: RuntimePaths,
  bundleId: string,
): Record<string, string> {
  return {
    UV_CACHE_DIR: managedInstantReferenceUvCacheRoot(paths, bundleId),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

export function patchSharedRuntimeProjectSource(source: string): string {
  const bundledPath = "../runtime/sd-scripts";
  const sharedPath = "../sd-scripts";
  if (source.includes(bundledPath)) {
    return source.replaceAll(bundledPath, sharedPath);
  }
  if (source.includes(sharedPath)) return source;
  throw new Error(
    "Instant Reference runtime project does not declare the pinned sd-scripts source.",
  );
}

interface ProvisionCommand {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

async function run(
  command: ProvisionCommand,
  signal: AbortSignal | undefined,
  onLog: ((message: string) => void) | undefined,
): Promise<void> {
  onLog?.(`$ ${command.executable} ${command.args.join(" ")}`);
  const child = Bun.spawn([command.executable, ...command.args], {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    ...(signal ? { signal } : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean)) {
    onLog?.(line);
  }
  if (exitCode !== 0) {
    throw new Error(
      `Runtime provisioning command failed with exit code ${exitCode}: ${stderr.slice(-2_000)}`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isManagedInstantReferenceRuntimeReady(
  marker: string,
  verifyImports: () => Promise<void>,
): Promise<boolean> {
  try {
    if (
      (await readFile(marker, "utf8")).trim() !==
      MANAGED_INSTANT_REFERENCE_SETUP_VERSION
    ) {
      return false;
    }
    await verifyImports();
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryIfMissing(
  source: string,
  destination: string,
): Promise<void> {
  if (await exists(destination)) return;
  const staging = `${destination}.staging-${crypto.randomUUID()}`;
  try {
    await cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export class EmbeddedTrainingRuntimeProvisioner implements RuntimeProvisioner {
  async provision(context: RuntimeProvisionContext): Promise<void> {
    const artifactIds = new Set(
      context.manifest.artifacts.map((artifact) => artifact.id),
    );
    const required = [
      "comfyui",
      "instant-reference",
      "python312",
      "uv",
      "sd-scripts",
      "wd14-model",
      "wd14-tags",
    ];
    if (required.some((id) => !artifactIds.has(id))) {
      // Small injected manifests intentionally do not carry the Anima trainer.
      return;
    }

    const instantRoot = join(
      context.releaseRoot,
      "ComfyUI",
      "custom_nodes",
      "comfyui-instant-reference",
    );
    const runtimeSourcePath = join(instantRoot, "src", "runtime.py");
    const originalSource = await readFile(runtimeSourcePath, "utf8");
    await writeFile(
      runtimeSourcePath,
      patchInstantReferenceRuntimeSource(originalSource),
      "utf8",
    );
    const sharedRuntime = managedInstantReferenceRuntimeRoot(
      context.paths,
      context.manifest.bundleId,
    );
    await mkdir(sharedRuntime, { recursive: true });
    await copyDirectoryIfMissing(
      join(instantRoot, "runtime", "sd-scripts"),
      join(sharedRuntime, "sd-scripts"),
    );
    const runtimeProject = join(sharedRuntime, "runtime_env");
    await copyDirectoryIfMissing(
      join(instantRoot, "runtime_env"),
      runtimeProject,
    );
    await copyDirectoryIfMissing(
      join(context.releaseRoot, "_managed", "python312"),
      join(sharedRuntime, "python312"),
    );
    for (const filename of ["pyproject.toml", "uv.lock"]) {
      const path = join(runtimeProject, filename);
      const source = await readFile(path, "utf8");
      const patched = patchSharedRuntimeProjectSource(source);
      if (patched !== source) {
        await writeFile(path, patched, "utf8");
      }
    }

    const comfyPython = join(
      context.releaseRoot,
      "python_embeded",
      "python.exe",
    );
    for (const requirements of [
      join(instantRoot, "requirements.txt"),
      join(
        context.releaseRoot,
        "ComfyUI",
        "custom_nodes",
        "ComfyUI-KJNodes",
        "requirements.txt",
      ),
    ]) {
      if (!(await exists(requirements))) continue;
      await run(
        {
          executable: comfyPython,
          args: [
            "-s",
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            requirements,
          ],
          cwd: context.releaseRoot,
        },
        context.signal,
        context.onLog,
      );
    }

    const uv = join(
      context.releaseRoot,
      "_managed",
      "tools",
      "uv",
      "uv.exe",
    );
    const python312 = join(sharedRuntime, "python312", "python.exe");
    const venv = join(sharedRuntime, "venv");
    const venvPython = join(venv, "Scripts", "python.exe");
    const marker = join(venv, ".sd_scripts_ready");
    const uvEnvironment = managedInstantReferenceUvEnvironment(
      context.paths,
      context.manifest.bundleId,
    );
    const environment = {
      ...uvEnvironment,
      VIRTUAL_ENV: venv,
      UV_PYTHON: venvPython,
    };
    const ready = await isManagedInstantReferenceRuntimeReady(
      marker,
      async () => {
        await run(
          {
            executable: venvPython,
            args: ["-c", "import torch, torchvision, xformers, library"],
            cwd: sharedRuntime,
            env: environment,
          },
          context.signal,
          context.onLog,
        );
      },
    );
    context.signal?.throwIfAborted();
    if (!ready && (await exists(marker))) {
      context.onLog?.(
        "Managed Instant Reference environment is incomplete; rebuilding it.",
      );
    }
    if (!ready) {
      await run(
        {
          executable: uv,
          args: ["venv", "--clear", "--python", python312, venv],
          cwd: sharedRuntime,
          env: uvEnvironment,
        },
        context.signal,
        context.onLog,
      );
      await run(
        {
          executable: uv,
          args: [
            "sync",
            "--frozen",
            "--python",
            venvPython,
            "--active",
            "--project",
            runtimeProject,
            "--no-install-project",
          ],
          cwd: runtimeProject,
          env: environment,
        },
        context.signal,
        context.onLog,
      );
      await run(
        {
          executable: venvPython,
          args: ["-c", "import torch, torchvision, xformers, library"],
          cwd: sharedRuntime,
          env: environment,
        },
        context.signal,
        context.onLog,
      );
      await writeFile(
        marker,
        `${MANAGED_INSTANT_REFERENCE_SETUP_VERSION}\n`,
        "utf8",
      );
    }
  }
}
