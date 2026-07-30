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
import { ANIMA_LORA_MANAGER_DOWNLOAD_CONTRACT } from "../contracts/lora-manager";

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

export const LORA_MANAGER_SECRET_PATCH_ID =
  "anima-lora-manager-env-secret-v1";
export const ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID =
  ANIMA_LORA_MANAGER_DOWNLOAD_CONTRACT;
export const MANAGED_INSTANT_REFERENCE_SETUP_VERSION = "13";
const INSTANT_REFERENCE_BUNDLE_KEY_LENGTH = 12;

const ALLOWED_CUSTOM_NODE_DIRECTORIES = new Set([
  "comfyui-instant-reference",
  "ComfyUI-KJNodes",
  "ComfyUI-Lora-Manager",
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

/**
 * Keeps CIVITAI_API_KEY process-local. LoRA Manager's normal implementation
 * copies that environment value into settings.json; managed mode must never do
 * so because Anima owns the DPAPI-protected credential.
 */
export function patchLoraManagerCredentialSource(source: string): string {
  let result = replaceOne(
    source,
    /    def _check_environment_variables\(self\) -> None:\r?\n        """Check for environment variables and update settings if needed"""[\s\S]*?(?=\r?\n    def _default_settings_actions)/,
    [
      "    def _check_environment_variables(self) -> None:",
      `        """${LORA_MANAGER_SECRET_PATCH_ID}: keep provider credentials process-local."""`,
      '        self.settings.pop("civitai_api_key", None)',
      '        if os.environ.get("CIVITAI_API_KEY"):',
      '            logger.info("Using process-local CIVITAI_API_KEY environment variable")',
      "",
    ].join("\n"),
    "LoRA Manager environment credential",
  );
  result = replaceOne(
    result,
    /    def get\(self, key: str, default: Any = None\) -> Any:\r?\n        """Get setting value"""\r?\n        return self\.settings\.get\(key, default\)/,
    [
      "    def get(self, key: str, default: Any = None) -> Any:",
      '        """Get setting value without persisting managed provider credentials."""',
      '        if key == "civitai_api_key":',
      '            env_value = os.environ.get("CIVITAI_API_KEY", "").strip()',
      "            if env_value:",
      "                return env_value",
      "        return self.settings.get(key, default)",
    ].join("\n"),
    "LoRA Manager credential getter",
  );
  const serializerPattern =
    /    def _serialize_settings_for_disk\(self\) -> Dict\[str, Any\]:[\s\S]*?(?=\r?\n    def get_libraries)/;
  const serializer = result.match(serializerPattern)?.[0];
  if (!serializer) {
    throw new Error(
      "LoRA Manager patch anchor is missing: settings serializer.",
    );
  }
  const patchedSerializer = serializer.replace(
    /^(\s*)return minimal$/gm,
    '$1minimal.pop("civitai_api_key", None)\n$1return minimal',
  );
  if (patchedSerializer === serializer) {
    throw new Error(
      "LoRA Manager patch made no change: settings serializer.",
    );
  }
  result = result.replace(serializerPattern, patchedSerializer);
  return result;
}

/**
 * Turns LoRA Manager's generic download route into a narrow managed-runtime
 * boundary. The app supplies only root IDs while this patched handler resolves
 * them against process-owned paths and rechecks the final file before returning
 * it to the TypeScript verifier.
 */
export function patchLoraManagerDownloadHandlerSource(
  source: string,
): string {
  return replaceOne(
    source,
    /    async def download_model\(self, request: web\.Request\) -> web\.Response:[\s\S]*?(?=\r?\n    async def download_model_get)/,
    [
      "    async def download_model(self, request: web.Request) -> web.Response:",
      `        """${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}: managed downloads only."""`,
      "",
      "        def _positive_id(value):",
      "            return type(value) is int and value > 0",
      "",
      "        def _inside(root, candidate):",
      "            root_path = os.path.normcase(os.path.realpath(os.path.abspath(root)))",
      "            candidate_path = os.path.normcase(",
      "                os.path.realpath(os.path.abspath(candidate))",
      "            )",
      "            try:",
      "                return os.path.commonpath([root_path, candidate_path]) == root_path",
      "            except ValueError:",
      "                return False",
      "",
      "        try:",
      `            contract = "${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}"`,
      '            if request.headers.get("x-anima-lm-contract") != contract:',
      '                raise DownloadModelValidationError("Managed download contract is required")',
      "",
      "            payload = await request.json()",
      "            if not isinstance(payload, dict):",
      '                raise DownloadModelValidationError("Download payload must be an object")',
      "            allowed_keys = {",
      '                "contract_version",',
      '                "model_id",',
      '                "model_version_id",',
      '                "model_root",',
      '                "relative_path",',
      '                "use_default_paths",',
      '                "download_id",',
      '                "source",',
      '                "expected_sha256",',
      '                "allowed_extension",',
      '                "destination_root_id",',
      '                "file_params",',
      "            }",
      "            if set(payload) != allowed_keys:",
      '                raise DownloadModelValidationError("Download payload keys are invalid")',
      '            if payload.get("contract_version") != contract:',
      '                raise DownloadModelValidationError("Managed download contract is invalid")',
      '            if not _positive_id(payload.get("model_id")):',
      '                raise DownloadModelValidationError("model_id must be a positive integer")',
      '            if not _positive_id(payload.get("model_version_id")):',
      '                raise DownloadModelValidationError("model_version_id must be a positive integer")',
      "",
      '            download_id = payload.get("download_id")',
      "            if not isinstance(download_id, str) or not re.fullmatch(",
      '                r"[A-Za-z0-9_-]{1,128}", download_id',
      "            ):",
      '                raise DownloadModelValidationError("download_id is invalid")',
      '            if payload.get("source") != "civitai":',
      '                raise DownloadModelValidationError("source must be civitai")',
      '            if payload.get("relative_path") != "":',
      '                raise DownloadModelValidationError("relative_path must be empty")',
      '            if payload.get("use_default_paths") is not False:',
      '                raise DownloadModelValidationError("default paths are not allowed")',
      '            if payload.get("allowed_extension") != ".safetensors":',
      '                raise DownloadModelValidationError("Only .safetensors is allowed")',
      "",
      '            expected_sha = payload.get("expected_sha256")',
      "            if not isinstance(expected_sha, str) or not re.fullmatch(",
      '                r"[A-Fa-f0-9]{64}", expected_sha',
      "            ):",
      '                raise DownloadModelValidationError("expected_sha256 is invalid")',
      "",
      '            destination_root_id = payload.get("destination_root_id")',
      '            roots_json = os.environ.get("ANIMA_MANAGED_MODEL_ROOTS", "")',
      "            try:",
      "                allowed_roots = json.loads(roots_json)",
      "            except (TypeError, ValueError, json.JSONDecodeError):",
      '                raise DownloadModelValidationError("Managed model roots are unavailable")',
      "            if not isinstance(allowed_roots, dict):",
      '                raise DownloadModelValidationError("Managed model roots are invalid")',
      "            configured_root = allowed_roots.get(destination_root_id)",
      "            model_root = payload.get(\"model_root\")",
      "            if (",
      "                not isinstance(configured_root, str)",
      "                or not os.path.isabs(configured_root)",
      "                or not isinstance(model_root, str)",
      "                or not os.path.isabs(model_root)",
      "                or not _inside(configured_root, model_root)",
      "            ):",
      '                raise DownloadModelValidationError("model_root is outside the managed destination")',
      "",
      '            file_params = payload.get("file_params")',
      "            if not isinstance(file_params, dict) or set(file_params) != {",
      '                "id", "name", "type", "format", "size", "fp", "isPrimary"',
      "            }:",
      '                raise DownloadModelValidationError("file_params are invalid")',
      '            if not _positive_id(file_params.get("id")):',
      '                raise DownloadModelValidationError("file_params.id is invalid")',
      '            filename = file_params.get("name")',
      "            if (",
      "                not isinstance(filename, str)",
      "                or os.path.basename(filename) != filename",
      '                or not filename.lower().endswith(".safetensors")',
      "            ):",
      '                raise DownloadModelValidationError("file_params.name is invalid")',
      '            if file_params.get("type") not in ("Model", "Diffusion Model"):',
      '                raise DownloadModelValidationError("file_params.type is invalid")',
      '            if file_params.get("format") != "SafeTensor":',
      '                raise DownloadModelValidationError("file_params.format is invalid")',
      "",
      "            payload = dict(payload)",
      "            payload[\"model_root\"] = os.path.abspath(model_root)",
      "            payload[\"expected_sha256\"] = expected_sha.lower()",
      "            payload[\"file_params\"] = dict(file_params)",
      "            payload[\"file_params\"][\"expected_sha256\"] = expected_sha.lower()",
      "            result = await self._download_use_case.execute(payload)",
      "            if not result.get(\"success\", False):",
      "                return web.json_response(result, status=500)",
      "",
      '            final_path = result.get("path")',
      "            if (",
      "                not isinstance(final_path, str)",
      "                or not os.path.isabs(final_path)",
      '                or not final_path.lower().endswith(".safetensors")',
      "                or not _inside(payload[\"model_root\"], final_path)",
      "                or not os.path.isfile(final_path)",
      "                or os.path.islink(final_path)",
      "            ):",
      '                raise RuntimeError("Managed download returned an invalid final path")',
      "            result = dict(result)",
      "            result[\"path\"] = os.path.abspath(final_path)",
      "            result[\"contract_version\"] = contract",
      "            return web.json_response(result)",
      "        except DownloadModelValidationError as exc:",
      "            return web.json_response({\"success\": False, \"error\": str(exc)}, status=400)",
      "        except DownloadModelEarlyAccessError as exc:",
      '            self._logger.warning("Early access error: %s", exc)',
      "            return web.json_response({\"success\": False, \"error\": str(exc)}, status=401)",
      "        except Exception as exc:",
      '            self._logger.error("Managed model download failed", exc_info=True)',
      "            return web.json_response(",
      '                {"success": False, "error": "Managed model download failed"},',
      "                status=500,",
      "            )",
      "",
    ].join("\n"),
    "LoRA Manager managed download handler",
  );
}

/**
 * Removes LoRA Manager's metadata/primary fallback and makes the exact Civitai
 * file ID and SHA-256 selected by the app authoritative.
 */
export function patchLoraManagerDownloadManagerSource(
  source: string,
): string {
  let result = replaceOne(
    source,
    /            # If file_params is provided, try to find matching file[\s\S]*?            if not file_info:\r?\n                return \{"success": False, "error": "No suitable file found in metadata"\}\r?\n/,
    [
      `            # ${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}: exact verified file only`,
      "            if not isinstance(file_params, dict):",
      '                return {"success": False, "error": "Managed file selection is required"}',
      '            target_file_id = file_params.get("id")',
      '            target_name = file_params.get("name")',
      '            expected_sha = file_params.get("expected_sha256")',
      "            if type(target_file_id) is not int or target_file_id <= 0:",
      '                return {"success": False, "error": "Managed file ID is invalid"}',
      "            if (",
      "                not isinstance(target_name, str)",
      "                or os.path.basename(target_name) != target_name",
      '                or not target_name.lower().endswith(".safetensors")',
      "            ):",
      '                return {"success": False, "error": "Managed filename is invalid"}',
      "            if (",
      "                not isinstance(expected_sha, str)",
      "                or len(expected_sha) != 64",
      "                or any(character not in \"0123456789abcdefABCDEF\" for character in expected_sha)",
      "            ):",
      '                return {"success": False, "error": "Managed SHA-256 is invalid"}',
      "",
      "            file_info = next(",
      "                (f for f in files if f.get(\"id\") == target_file_id),",
      "                None,",
      "            )",
      "            if not file_info:",
      '                return {"success": False, "error": "Selected Civitai file ID was not found"}',
      '            if file_info.get("name") != target_name:',
      '                return {"success": False, "error": "Selected Civitai filename does not match"}',
      '            if file_info.get("type") not in ("Model", "Diffusion Model"):',
      '                return {"success": False, "error": "Selected Civitai file type is unsupported"}',
      '            remote_metadata = file_info.get("metadata") or {}',
      '            if remote_metadata.get("format") != "SafeTensor":',
      '                return {"success": False, "error": "Selected Civitai file is not SafeTensor"}',
      '            remote_hashes = file_info.get("hashes") or {}',
      '            remote_sha = remote_hashes.get("SHA256") or remote_hashes.get("sha256")',
      "            if (",
      "                not isinstance(remote_sha, str)",
      "                or remote_sha.lower() != expected_sha.lower()",
      "            ):",
      '                return {"success": False, "error": "Selected Civitai SHA-256 does not match"}',
      "",
    ].join("\n"),
    "LoRA Manager exact file selection",
  );
  result = replaceOne(
    result,
    /            # Report 100% completion\r?\n            if progress_callback:\r?\n                await progress_callback\(100\)\r?\n\r?\n            return \{"success": True\}/,
    [
      `            # ${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}: expose one verified path`,
      "            if len(actual_file_paths) != 1:",
      '                raise RuntimeError("Managed download produced multiple model files")',
      "            final_path = os.path.abspath(actual_file_paths[0])",
      "            if (",
      "                not os.path.isfile(final_path)",
      "                or os.path.islink(final_path)",
      '                or not final_path.lower().endswith(".safetensors")',
      "            ):",
      '                raise RuntimeError("Managed download did not produce one regular .safetensors file")',
      "",
      "            # Report 100% completion",
      "            if progress_callback:",
      "                await progress_callback(100)",
      "",
      "            return {",
      '                "success": True,',
      '                "path": final_path,',
      `                "contract_version": "${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}",`,
      "            }",
    ].join("\n"),
    "LoRA Manager final managed path",
  );
  return result;
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
    const loraManagerRoot = join(
      context.releaseRoot,
      "ComfyUI",
      "custom_nodes",
      "ComfyUI-Lora-Manager",
    );
    const settingsManagerPath = join(
      loraManagerRoot,
      "py",
      "services",
      "settings_manager.py",
    );
    const downloadHandlerPath = join(
      loraManagerRoot,
      "py",
      "routes",
      "handlers",
      "model_handlers.py",
    );
    const downloadManagerPath = join(
      loraManagerRoot,
      "py",
      "services",
      "download_manager.py",
    );
    const patchedSettings = patchLoraManagerCredentialSource(
      await readFile(settingsManagerPath, "utf8"),
    );
    const patchedDownloadHandler =
      patchLoraManagerDownloadHandlerSource(
        await readFile(downloadHandlerPath, "utf8"),
      );
    const patchedDownloadManager =
      patchLoraManagerDownloadManagerSource(
        await readFile(downloadManagerPath, "utf8"),
      );
    if (!patchedSettings.includes(LORA_MANAGER_SECRET_PATCH_ID)) {
      throw new Error("LoRA Manager credential patch verification failed.");
    }
    if (
      !patchedDownloadHandler.includes(
        ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID,
      ) ||
      !patchedDownloadManager.includes(
        ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID,
      )
    ) {
      throw new Error("LoRA Manager download patch verification failed.");
    }
    await writeFile(settingsManagerPath, patchedSettings, "utf8");
    await writeFile(
      downloadHandlerPath,
      patchedDownloadHandler,
      "utf8",
    );
    await writeFile(
      downloadManagerPath,
      patchedDownloadManager,
      "utf8",
    );
    await writeFile(
      join(loraManagerRoot, `.${LORA_MANAGER_SECRET_PATCH_ID}`),
      `${LORA_MANAGER_SECRET_PATCH_ID}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(
      join(
        loraManagerRoot,
        `.${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}`,
      ),
      `${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}\n`,
      { encoding: "utf8", flag: "wx" },
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
      join(
        context.releaseRoot,
        "ComfyUI",
        "custom_nodes",
        "ComfyUI-Lora-Manager",
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
