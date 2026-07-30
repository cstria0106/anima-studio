import { isAbsolute } from "node:path";
import { ANIMA_LORA_MANAGER_DOWNLOAD_CONTRACT } from "../contracts/lora-manager";
import { CivitaiError, assertCivitai } from "./errors";
import { normalizeSha256 } from "./parser";
import type {
  CivitaiFileInspection,
  CivitaiModelKind,
  ModelDownloadProgress,
  ResolvedDestination,
} from "./types";

export const ANIMA_LORA_MANAGER_CONTRACT =
  ANIMA_LORA_MANAGER_DOWNLOAD_CONTRACT;

const validDownloadId = /^[a-zA-Z0-9_-]{1,128}$/;
const maximumLocalResponseBytes = 2 * 1_024 * 1_024;

interface LocalHttpResponse {
  status: number;
  body: unknown;
}

export interface LoraManagerDownloadPayload {
  contract_version: typeof ANIMA_LORA_MANAGER_CONTRACT;
  model_id: number;
  model_version_id: number;
  model_root: string;
  relative_path: "";
  use_default_paths: false;
  download_id: string;
  source: "civitai";
  expected_sha256: string;
  allowed_extension: ".safetensors";
  destination_root_id: string;
  file_params: {
    id: number;
    name: string;
    type: string;
    format: "SafeTensor";
    size: string;
    fp: string | null;
    isPrimary: boolean;
  };
}

/**
 * A deliberately narrow transport contract. Unlike a generic ComfyUI proxy it
 * cannot invoke unrelated LoRA Manager routes.
 */
export interface LoraManagerTransport {
  download(
    payload: LoraManagerDownloadPayload,
    signal?: AbortSignal,
  ): Promise<LocalHttpResponse>;
  progress(downloadId: string): Promise<LocalHttpResponse>;
  pause(downloadId: string): Promise<LocalHttpResponse>;
  resume(downloadId: string): Promise<LocalHttpResponse>;
  cancel(downloadId: string): Promise<LocalHttpResponse>;
}

function validateManagedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CivitaiError(
      "INCOMPATIBLE_LORA_MANAGER",
      "The managed LoRA Manager URL is invalid.",
      500,
    );
  }
  const host = url.hostname.toLocaleLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !["127.0.0.1", "localhost", "[::1]"].includes(host) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CivitaiError(
      "INCOMPATIBLE_LORA_MANAGER",
      "LoRA Manager must use a loopback-only URL.",
      500,
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function readLocalJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumLocalResponseBytes) {
    throw new CivitaiError(
      "INCOMPATIBLE_LORA_MANAGER",
      "LoRA Manager returned an invalid response.",
      502,
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumLocalResponseBytes) {
    throw new CivitaiError(
      "INCOMPATIBLE_LORA_MANAGER",
      "LoRA Manager returned an invalid response.",
      502,
    );
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CivitaiError(
      "INCOMPATIBLE_LORA_MANAGER",
      "LoRA Manager returned an invalid response.",
      502,
    );
  }
}

export class FetchLoraManagerTransport
  implements LoraManagerTransport
{
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly controlTimeoutMs = 15_000,
  ) {
    this.baseUrl = validateManagedBaseUrl(baseUrl);
  }

  private async request(
    pathname: string,
    init: RequestInit,
    useControlTimeout: boolean,
  ): Promise<LocalHttpResponse> {
    let response: Response;
    try {
      const {
        signal: suppliedSignal,
        ...requestWithoutSignal
      } = init;
      const signal =
        suppliedSignal ??
        (useControlTimeout
          ? AbortSignal.timeout(this.controlTimeoutMs)
          : null);
      response = await this.fetcher(`${this.baseUrl}${pathname}`, {
        ...requestWithoutSignal,
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new CivitaiError(
        "REMOTE_UNAVAILABLE",
        "Managed LoRA Manager could not be reached.",
        502,
      );
    }
    return {
      status: response.status,
      body: await readLocalJson(response),
    };
  }

  download(
    payload: LoraManagerDownloadPayload,
    signal?: AbortSignal,
  ): Promise<LocalHttpResponse> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-anima-lm-contract": ANIMA_LORA_MANAGER_CONTRACT,
      },
      body: JSON.stringify(payload),
    };
    if (signal) init.signal = signal;
    return this.request("/api/lm/download-model", init, false);
  }

  progress(downloadId: string): Promise<LocalHttpResponse> {
    return this.request(
      `/api/lm/download-progress/${encodeURIComponent(downloadId)}`,
      { method: "GET", headers: { accept: "application/json" } },
      true,
    );
  }

  pause(downloadId: string): Promise<LocalHttpResponse> {
    return this.control("/api/lm/pause-download", downloadId);
  }

  resume(downloadId: string): Promise<LocalHttpResponse> {
    return this.control("/api/lm/resume-download", downloadId);
  }

  cancel(downloadId: string): Promise<LocalHttpResponse> {
    return this.control("/api/lm/cancel-download-get", downloadId);
  }

  private control(
    pathname: string,
    downloadId: string,
  ): Promise<LocalHttpResponse> {
    const query = new URLSearchParams({ download_id: downloadId });
    return this.request(
      `${pathname}?${query}`,
      { method: "GET", headers: { accept: "application/json" } },
      true,
    );
  }
}

export interface LoraManagerDownloadInput {
  downloadId: string;
  modelId: number;
  versionId: number;
  modelKind: CivitaiModelKind;
  file: CivitaiFileInspection;
  destination: ResolvedDestination;
  signal?: AbortSignal;
}

export interface LoraManagerDownloadCompletion {
  downloadId: string;
  finalPath: string;
  expectedSha256: string | null;
  actualSha256: string | null;
}

export interface LoraManagerClient {
  download(
    input: LoraManagerDownloadInput,
  ): Promise<LoraManagerDownloadCompletion>;
  getProgress(downloadId: string): Promise<ModelDownloadProgress>;
  pause(downloadId: string): Promise<void>;
  resume(downloadId: string): Promise<void>;
  cancel(downloadId: string): Promise<void>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function normalizePercent(value: unknown): number {
  const numeric = numberOrNull(value) ?? 0;
  return Math.min(100, Math.max(0, numeric));
}

function ensureDownloadId(downloadId: string): void {
  assertCivitai(
    validDownloadId.test(downloadId),
    "DOWNLOAD_FAILED",
    "The download ID is invalid.",
  );
}

function managerError(status: number): CivitaiError {
  if (status === 404) {
    return new CivitaiError(
      "DOWNLOAD_NOT_FOUND",
      "The model download was not found.",
      404,
    );
  }
  return new CivitaiError(
    "DOWNLOAD_FAILED",
    "LoRA Manager rejected the model download.",
    status >= 400 && status < 500 ? 400 : 502,
  );
}

export class PinnedLoraManagerClient implements LoraManagerClient {
  constructor(private readonly transport: LoraManagerTransport) {}

  async download(
    input: LoraManagerDownloadInput,
  ): Promise<LoraManagerDownloadCompletion> {
    ensureDownloadId(input.downloadId);
    assertCivitai(
      Number.isSafeInteger(input.modelId) && input.modelId > 0,
      "INVALID_MODEL",
      "The Civitai model ID is invalid.",
    );
    assertCivitai(
      Number.isSafeInteger(input.versionId) && input.versionId > 0,
      "INVALID_VERSION",
      "The Civitai model version is invalid.",
    );
    assertCivitai(
      input.file.eligible &&
        input.file.id !== null &&
        input.file.sha256 !== null,
      "UNSUPPORTED_FILE",
      "The selected Civitai file cannot be downloaded.",
    );
    assertCivitai(
      isAbsolute(input.destination.absoluteDirectory),
      "INVALID_DESTINATION",
      "The managed model destination is invalid.",
      500,
    );

    const payload: LoraManagerDownloadPayload = {
      contract_version: ANIMA_LORA_MANAGER_CONTRACT,
      model_id: input.modelId,
      model_version_id: input.versionId,
      model_root: input.destination.absoluteDirectory,
      relative_path: "",
      use_default_paths: false,
      download_id: input.downloadId,
      source: "civitai",
      expected_sha256: input.file.sha256,
      allowed_extension: ".safetensors",
      destination_root_id: input.destination.rootId,
      file_params: {
        id: input.file.id,
        name: input.file.name,
        type: input.file.remoteType,
        format: "SafeTensor",
        size: input.file.sizeVariant ?? "full",
        fp: input.file.precision,
        isPrimary: input.file.primary,
      },
    };
    const response = await this.transport.download(
      payload,
      input.signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw managerError(response.status);
    }
    const body = record(response.body);
    const finalPath =
      typeof body?.path === "string" ? body.path : null;
    const expectedSha256 = normalizeSha256(body?.expected_sha256);
    const actualSha256 = normalizeSha256(body?.actual_sha256);
    if (
      body?.success !== true ||
      body.download_id !== input.downloadId ||
      body.contract_version !== ANIMA_LORA_MANAGER_CONTRACT ||
      !finalPath ||
      !isAbsolute(finalPath) ||
      !finalPath.toLocaleLowerCase().endsWith(".safetensors")
    ) {
      throw new CivitaiError(
        "INCOMPATIBLE_LORA_MANAGER",
        "LoRA Manager does not satisfy the managed download contract.",
        502,
      );
    }
    return {
      downloadId: input.downloadId,
      finalPath,
      expectedSha256,
      actualSha256,
    };
  }

  async getProgress(
    downloadId: string,
  ): Promise<ModelDownloadProgress> {
    ensureDownloadId(downloadId);
    const response = await this.transport.progress(downloadId);
    if (response.status < 200 || response.status >= 300) {
      throw managerError(response.status);
    }
    const body = record(response.body);
    if (body?.success !== true) throw managerError(404);
    const remoteStatus =
      typeof body.status === "string"
        ? body.status.toLocaleLowerCase()
        : "downloading";
    const state: ModelDownloadProgress["state"] =
      remoteStatus === "paused"
        ? "paused"
        : remoteStatus === "cancelled"
          ? "cancelled"
          : remoteStatus === "completed"
            ? "completed"
            : remoteStatus === "failed" || remoteStatus === "error"
              ? "failed"
              : remoteStatus === "queued"
                ? "queued"
                : "downloading";
    return {
      downloadId,
      state,
      percent: normalizePercent(body.progress),
      bytesDownloaded: numberOrNull(body.bytes_downloaded),
      totalBytes: numberOrNull(body.total_bytes),
      bytesPerSecond: numberOrNull(body.bytes_per_second),
    };
  }

  pause(downloadId: string): Promise<void> {
    return this.control("pause", downloadId);
  }

  resume(downloadId: string): Promise<void> {
    return this.control("resume", downloadId);
  }

  cancel(downloadId: string): Promise<void> {
    return this.control("cancel", downloadId);
  }

  private async control(
    action: "pause" | "resume" | "cancel",
    downloadId: string,
  ): Promise<void> {
    ensureDownloadId(downloadId);
    const response = await this.transport[action](downloadId);
    if (response.status < 200 || response.status >= 300) {
      throw managerError(response.status);
    }
    if (record(response.body)?.success !== true) {
      throw managerError(400);
    }
  }
}
