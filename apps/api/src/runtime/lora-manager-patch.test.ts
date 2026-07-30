import { describe, expect, test } from "bun:test";

import {
  ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID,
  patchLoraManagerDownloadHandlerSource,
  patchLoraManagerDownloadManagerSource,
} from "./provision";

const pinnedHandlerSource = [
  "class ModelDownloadHandler:",
  '    """Coordinate downloads and progress reporting."""',
  "",
  "    async def download_model(self, request: web.Request) -> web.Response:",
  "        try:",
  "            payload = await request.json()",
  "            result = await self._download_use_case.execute(payload)",
  '            if not result.get("success", False):',
  "                return web.json_response(result, status=500)",
  "            return web.json_response(result)",
  "        except DownloadModelValidationError as exc:",
  '            return web.json_response({"success": False, "error": str(exc)}, status=400)',
  "        except DownloadModelEarlyAccessError as exc:",
  '            self._logger.warning("Early access error: %s", exc)',
  '            return web.json_response({"success": False, "error": str(exc)}, status=401)',
  "        except Exception as exc:",
  "            error_message = str(exc)",
  "            self._logger.error(",
  '                "Error downloading model: %s", error_message, exc_info=True',
  "            )",
  "            return web.json_response(",
  '                {"success": False, "error": error_message}, status=500',
  "            )",
  "",
  "    async def download_model_get(self, request: web.Request) -> web.Response:",
  "        pass",
  "",
].join("\n");

const pinnedManagerSource = [
  "            # 2. Get file information",
  '            files = version_info.get("files", [])',
  "            file_info = None",
  "",
  "            # If file_params is provided, try to find matching file",
  "            if file_params and model_version_id:",
  '                target_type = file_params.get("type", "Model")',
  '                target_format = file_params.get("format", "SafeTensor")',
  '                target_size = file_params.get("size", "full")',
  '                target_fp = file_params.get("fp")',
  '                is_primary = file_params.get("isPrimary", False)',
  "",
  "                if is_primary:",
  "                    # Find primary file",
  "                    file_info = next(",
  "                        (",
  "                            f",
  "                            for f in files",
  '                            if f.get("primary")',
  '                            and f.get("type") in ("Model", "Negative", "Diffusion Model")',
  "                        ),",
  "                        None,",
  "                    )",
  "                else:",
  "                    # Match by metadata",
  "                    for f in files:",
  '                        f_type = f.get("type", "")',
  '                        f_meta = f.get("metadata", {})',
  "",
  "                        # Check type match",
  "                        if f_type != target_type:",
  "                            continue",
  "",
  "                        # Check metadata match",
  '                        if f_meta.get("format") != target_format:',
  "                            continue",
  '                        if f_meta.get("size") != target_size:',
  "                            continue",
  '                        if target_fp and f_meta.get("fp") != target_fp:',
  "                            continue",
  "",
  "                        file_info = f",
  "                        break",
  "",
  "            # Fallback to primary file if no match found",
  "            if not file_info:",
  "                file_info = next(",
  "                    (",
  "                        f",
  "                        for f in files",
  '                        if f.get("primary") and f.get("type") in ("Model", "Negative", "Diffusion Model")',
  "                    ),",
  "                    None,",
  "                )",
  "",
  "            if not file_info:",
  '                return {"success": False, "error": "No suitable file found in metadata"}',
  '            mirrors = file_info.get("mirrors") or []',
  "",
  "            # Report 100% completion",
  "            if progress_callback:",
  "                await progress_callback(100)",
  "",
  '            return {"success": True}',
  "",
  "        except Exception as e:",
  "            pass",
  "",
].join("\n");

describe("managed LoRA Manager source patches", () => {
  test("replaces the pinned generic handler with a root-allowlisted contract", () => {
    const patched =
      patchLoraManagerDownloadHandlerSource(pinnedHandlerSource);

    expect(patched).toContain(
      `"""${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}: managed downloads only."""`,
    );
    expect(patched).toContain(
      'request.headers.get("x-anima-lm-contract")',
    );
    expect(patched).toContain("ANIMA_MANAGED_MODEL_ROOTS");
    expect(patched).toContain("set(payload) != allowed_keys");
    expect(patched).toContain('payload.get("relative_path") != ""');
    expect(patched).toContain(
      'payload.get("use_default_paths") is not False',
    );
    expect(patched).toContain('file_params.get("id")');
    expect(patched).toContain('result["contract_version"] = contract');
    expect(patched).not.toContain(
      '"Error downloading model: %s", error_message',
    );
  });

  test("selects an exact Civitai file and returns one absolute safetensors path", () => {
    const patched =
      patchLoraManagerDownloadManagerSource(pinnedManagerSource);

    expect(patched).toContain(
      '(f for f in files if f.get("id") == target_file_id)',
    );
    expect(patched).toContain(
      'file_info.get("name") != target_name',
    );
    expect(patched).toContain(
      'remote_sha.lower() != expected_sha.lower()',
    );
    expect(patched).toContain("len(actual_file_paths) != 1");
    expect(patched).toContain(
      'not final_path.lower().endswith(".safetensors")',
    );
    expect(patched).toContain('"path": final_path');
    expect(patched).toContain(
      `"contract_version": "${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}"`,
    );
    expect(patched).not.toContain("Fallback to primary file");
    expect(patched).not.toContain("is_primary");
  });

  test("fails installation when either pinned source anchor changes", () => {
    expect(() =>
      patchLoraManagerDownloadHandlerSource("async def other(): pass"),
    ).toThrow("LoRA Manager managed download handler");
    expect(() =>
      patchLoraManagerDownloadManagerSource("async def other(): pass"),
    ).toThrow("LoRA Manager exact file selection");
  });
});
