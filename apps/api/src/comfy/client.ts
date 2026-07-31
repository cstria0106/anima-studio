import {
  CURATED_IMAGE_PRESETS,
  type ComfyOptions,
} from "@anima/shared";
import type {
  ComfyHistory,
  ComfyImageRef,
  ComfyObjectInfo,
  ComfyPrompt,
  ComfyPreviewFrame,
  ComfyQueue,
  ComfySocketEvent,
} from "./types";
import { isInstantReferenceGeneratedLora } from "./instant-reference";

export class ComfyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ComfyHttpError";
  }
}

export interface UploadImageInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  subfolder: string;
}

export interface UploadedImage {
  filename: string;
  subfolder: string;
  type: string;
  inputName: string;
}

export interface DownloadedOutput {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface QueuePromptResult {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

export interface SocketHandle {
  close(): void;
}

export interface ComfyClientLike {
  readonly baseUrl: string;
  health(): Promise<boolean>;
  getObjectInfo(): Promise<ComfyObjectInfo>;
  getOptions(): Promise<ComfyOptions>;
  getQueue(): Promise<ComfyQueue>;
  getHistory(promptId: string): Promise<ComfyHistory>;
  uploadImage(input: UploadImageInput): Promise<UploadedImage>;
  queuePrompt(
    prompt: ComfyPrompt,
    clientId: string,
    extraData?: Record<string, unknown>,
  ): Promise<QueuePromptResult>;
  downloadOutput(ref: ComfyImageRef): Promise<DownloadedOutput>;
  cancelQueued(promptId: string): Promise<void>;
  interrupt(): Promise<void>;
  free?(): Promise<void>;
  connect(
    clientId: string,
    handlers: {
      onOpen?(): void;
      onClose?(): void;
      onError?(error: unknown): void;
      onEvent(event: ComfySocketEvent): void;
      onPreview?(frame: ComfyPreviewFrame): void;
    },
  ): SocketHandle;
}

const PREVIEW_IMAGE_EVENT = 1;
const PREVIEW_IMAGE_WITH_METADATA_EVENT = 4;

interface PreviewContext {
  promptId: string | null;
  nodeId: string | null;
  step: number | null;
  total: number | null;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (bytes.byteLength < offset + 4) return null;
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, false);
}

function previewMimeType(value: unknown): "image/jpeg" | "image/png" | null {
  if (value === 1 || value === "image/jpeg") return "image/jpeg";
  if (value === 2 || value === "image/png") return "image/png";
  return null;
}

export function decodeComfyPreviewFrame(
  bytes: Uint8Array,
  context: PreviewContext = {
    promptId: null,
    nodeId: null,
    step: null,
    total: null,
  },
): ComfyPreviewFrame | null {
  const eventType = readUint32(bytes, 0);
  if (eventType === PREVIEW_IMAGE_EVENT) {
    const mimeType = previewMimeType(readUint32(bytes, 4));
    if (!mimeType || bytes.byteLength <= 8) return null;
    return {
      bytes: bytes.slice(8),
      mimeType,
      ...context,
    };
  }
  if (eventType !== PREVIEW_IMAGE_WITH_METADATA_EVENT) return null;

  const metadataLength = readUint32(bytes, 4);
  if (
    metadataLength === null ||
    metadataLength < 2 ||
    bytes.byteLength <= 8 + metadataLength
  ) {
    return null;
  }
  try {
    const metadata = JSON.parse(
      new TextDecoder().decode(bytes.subarray(8, 8 + metadataLength)),
    ) as Record<string, unknown>;
    const mimeType = previewMimeType(metadata.image_type);
    if (!mimeType) return null;
    return {
      bytes: bytes.slice(8 + metadataLength),
      mimeType,
      promptId:
        typeof metadata.prompt_id === "string"
          ? metadata.prompt_id
          : context.promptId,
      nodeId:
        typeof metadata.node_id === "string"
          ? metadata.node_id
          : context.nodeId,
      step: context.step,
      total: context.total,
    };
  } catch {
    return null;
  }
}

async function binaryBytes(value: unknown): Promise<Uint8Array | null> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  return null;
}

function firstChoice(value: unknown): string[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
  return value[0].filter((item): item is string => typeof item === "string");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export class ComfyClient implements ComfyClientLike {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    config: { comfyUrl: string; requestTimeoutMs: number },
    private readonly fetcher: typeof fetch = fetch,
    private readonly WebSocketImpl: typeof WebSocket = WebSocket,
  ) {
    this.baseUrl = config.comfyUrl.replace(/\/+$/, "");
    this.timeoutMs = config.requestTimeoutMs;
  }

  private async request(
    pathname: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${pathname}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");
      throw new ComfyHttpError(
        `ComfyUI request ${pathname} failed with HTTP ${response.status}.`,
        response.status,
        body,
      );
    }
    return response;
  }

  private async json<T>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    return (await this.request(pathname, init)).json() as Promise<T>;
  }

  async health(): Promise<boolean> {
    try {
      await this.request("/system_stats");
      return true;
    } catch {
      return false;
    }
  }

  getObjectInfo(): Promise<ComfyObjectInfo> {
    return this.json<ComfyObjectInfo>("/object_info");
  }

  private async models(folder: string): Promise<string[]> {
    try {
      const result = await this.json<unknown>(
        `/models/${encodeURIComponent(folder)}`,
      );
      return Array.isArray(result)
        ? result.filter((value): value is string => typeof value === "string")
        : [];
    } catch (error) {
      if (error instanceof ComfyHttpError && error.status === 404) return [];
      throw error;
    }
  }

  async getOptions(): Promise<ComfyOptions> {
    const [
      objectInfo,
      diffusionModels,
      unets,
      clips,
      textEncoders,
      vaes,
      loras,
    ] = await Promise.all([
      this.getObjectInfo(),
      this.models("diffusion_models"),
      this.models("unet"),
      this.models("clip"),
      this.models("text_encoders"),
      this.models("vae"),
      this.models("loras"),
    ]);

    const kSampler = objectInfo.KSampler;
    const samplerNames = firstChoice(kSampler?.input?.required?.sampler_name);
    const schedulerNames = firstChoice(
      kSampler?.input?.required?.scheduler,
    );
    const unetNames = firstChoice(
      objectInfo.UNETLoader?.input?.required?.unet_name,
    );
    const clipNames = firstChoice(
      objectInfo.CLIPLoader?.input?.required?.clip_name,
    );
    const vaeNames = firstChoice(
      objectInfo.VAELoader?.input?.required?.vae_name,
    );
    const loraNames = firstChoice(
      objectInfo.LoraLoader?.input?.required?.lora_name,
    );
    const customPresets = firstChoice(
      objectInfo.EmptyLatentImageCustomPresets?.input?.required?.dimensions,
    );
    const imagePresets = customPresets.flatMap((label) => {
      const match = label.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
      if (!match) return [];
      const width = Number(match[1]);
      const height = Number(match[2]);
      return Number.isSafeInteger(width) && Number.isSafeInteger(height)
        ? [{ label, width, height }]
        : [];
    });

    return {
      diffusionModels: uniqueSorted([
        ...diffusionModels,
        ...unets,
        ...unetNames,
      ]),
      clips: uniqueSorted([...clips, ...textEncoders, ...clipNames]),
      vaes: uniqueSorted([...vaes, ...vaeNames]),
      loras: uniqueSorted([...loras, ...loraNames]).filter(
        (lora) => !isInstantReferenceGeneratedLora(lora),
      ),
      samplers: uniqueSorted(samplerNames),
      schedulers: uniqueSorted(schedulerNames),
      imagePresets:
        imagePresets.length > 0
          ? imagePresets
          : [...CURATED_IMAGE_PRESETS],
    };
  }

  getQueue(): Promise<ComfyQueue> {
    return this.json<ComfyQueue>("/queue");
  }

  getHistory(promptId: string): Promise<ComfyHistory> {
    return this.json<ComfyHistory>(
      `/history/${encodeURIComponent(promptId)}`,
    );
  }

  async uploadImage(input: UploadImageInput): Promise<UploadedImage> {
    const form = new FormData();
    form.set(
      "image",
      new File([input.bytes.slice().buffer], input.filename, {
        type: input.mimeType,
      }),
    );
    form.set("type", "input");
    form.set("subfolder", input.subfolder);
    form.set("overwrite", "true");
    const response = await this.json<{
      name?: string;
      filename?: string;
      subfolder?: string;
      type?: string;
    }>("/upload/image", { method: "POST", body: form });
    const filename = response.name ?? response.filename;
    if (!filename) {
      throw new ComfyHttpError(
        "ComfyUI upload response did not include a filename.",
        502,
        response,
      );
    }
    const subfolder = response.subfolder ?? input.subfolder;
    const type = response.type ?? "input";
    return {
      filename,
      subfolder,
      type,
      inputName: subfolder ? `${subfolder}/${filename}` : filename,
    };
  }

  queuePrompt(
    prompt: ComfyPrompt,
    clientId: string,
    extraData: Record<string, unknown> = {},
  ): Promise<QueuePromptResult> {
    return this.json<QueuePromptResult>("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: clientId,
        extra_data: extraData,
      }),
    });
  }

  async downloadOutput(ref: ComfyImageRef): Promise<DownloadedOutput> {
    const query = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder ?? "",
      type: ref.type ?? "output",
    });
    const response = await this.request(`/view?${query}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
    };
  }

  async cancelQueued(promptId: string): Promise<void> {
    await this.request("/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    });
  }

  async interrupt(): Promise<void> {
    await this.request("/interrupt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  async free(): Promise<void> {
    await this.request("/free", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unload_models: true,
        free_memory: true,
      }),
    });
  }

  connect(
    clientId: string,
    handlers: {
      onOpen?(): void;
      onClose?(): void;
      onError?(error: unknown): void;
      onEvent(event: ComfySocketEvent): void;
      onPreview?(frame: ComfyPreviewFrame): void;
    },
  ): SocketHandle {
    const websocketUrl = new URL(this.baseUrl);
    websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
    websocketUrl.pathname = `${websocketUrl.pathname.replace(/\/$/, "")}/ws`;
    websocketUrl.search = new URLSearchParams({ clientId }).toString();

    const socket = new this.WebSocketImpl(websocketUrl);
    socket.binaryType = "arraybuffer";
    let previewContext: PreviewContext = {
      promptId: null,
      nodeId: null,
      step: null,
      total: null,
    };
    let messageChain = Promise.resolve();
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "feature_flags",
          data: { supports_preview_metadata: true },
        }),
      );
      handlers.onOpen?.();
    });
    socket.addEventListener("close", () => handlers.onClose?.());
    socket.addEventListener("error", (event) => handlers.onError?.(event));
    socket.addEventListener("message", (event) => {
      messageChain = messageChain
        .then(async () => {
          if (typeof event.data === "string") {
            try {
              const parsed = JSON.parse(event.data) as ComfySocketEvent;
              if (typeof parsed.type !== "string") return;
              if (parsed.type === "progress") {
                previewContext = {
                  promptId:
                    typeof parsed.data?.prompt_id === "string"
                      ? parsed.data.prompt_id
                      : null,
                  nodeId:
                    typeof parsed.data?.node === "string"
                      ? parsed.data.node
                      : typeof parsed.data?.node_id === "string"
                        ? parsed.data.node_id
                        : null,
                  step:
                    typeof parsed.data?.value === "number"
                      ? parsed.data.value
                      : null,
                  total:
                    typeof parsed.data?.max === "number"
                      ? parsed.data.max
                      : null,
                };
              } else if (
                parsed.type === "progress_state" &&
                parsed.data?.nodes &&
                typeof parsed.data.nodes === "object"
              ) {
                const nodes = Object.values(
                  parsed.data.nodes as Record<string, unknown>,
                ).flatMap((value) =>
                  value && typeof value === "object"
                    ? [value as Record<string, unknown>]
                    : [],
                );
                const active =
                  nodes.find((node) => node.state === "running") ??
                  nodes.at(-1);
                if (active) {
                  previewContext = {
                    promptId:
                      typeof active.prompt_id === "string"
                        ? active.prompt_id
                        : typeof parsed.data.prompt_id === "string"
                          ? parsed.data.prompt_id
                          : null,
                    nodeId:
                      typeof active.node_id === "string"
                        ? active.node_id
                        : null,
                    step:
                      typeof active.value === "number"
                        ? active.value
                        : null,
                    total:
                      typeof active.max === "number" ? active.max : null,
                  };
                }
              }
              handlers.onEvent(parsed);
            } catch {
              // Malformed third-party text messages are ignored.
            }
            return;
          }
          const bytes = await binaryBytes(event.data);
          if (!bytes) return;
          const preview = decodeComfyPreviewFrame(bytes, previewContext);
          if (preview) handlers.onPreview?.(preview);
        })
        .catch((error) => handlers.onError?.(error));
    });
    return { close: () => socket.close() };
  }
}
