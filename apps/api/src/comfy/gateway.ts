import type { ComfyOptions } from "@anima/shared";
import type {
  ComfyHistory,
  ComfyImageRef,
  ComfyObjectInfo,
  ComfyPreviewFrame,
  ComfyPrompt,
  ComfyQueue,
  ComfySocketEvent,
} from "./types";
import {
  ComfyClient,
  type ComfyClientLike,
  type DownloadedOutput,
  type QueuePromptResult,
  type SocketHandle,
  type UploadedImage,
  type UploadImageInput,
} from "./client";

export interface ComfyGatewayOptions {
  requestTimeoutMs: number;
  initialUrl: string;
  createClient?: (url: string) => ComfyClientLike;
}

export class SwitchableComfyGateway implements ComfyClientLike {
  private active: ComfyClientLike;
  private readonly createClient: (url: string) => ComfyClientLike;
  private enabled = true;

  constructor(options: ComfyGatewayOptions) {
    this.createClient =
      options.createClient ??
      ((url) =>
        new ComfyClient({
          comfyUrl: url,
          requestTimeoutMs: options.requestTimeoutMs,
        }));
    this.active = this.createClient(options.initialUrl);
  }

  get baseUrl(): string {
    return this.active.baseUrl;
  }

  get available(): boolean {
    return this.enabled;
  }

  setAvailable(available: boolean): boolean {
    if (this.enabled === available) return false;
    this.enabled = available;
    return true;
  }

  private assertAvailable(): void {
    if (!this.enabled) {
      throw new Error(
        "Managed ComfyUI is not ready. Install and start it before generating.",
      );
    }
  }

  switchTo(url: string): boolean {
    const normalized = url.replace(/\/+$/, "");
    if (normalized === this.baseUrl) return false;
    this.active = this.createClient(normalized);
    return true;
  }

  health(): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false);
    return this.active.health();
  }

  getObjectInfo(): Promise<ComfyObjectInfo> {
    this.assertAvailable();
    return this.active.getObjectInfo();
  }

  getOptions(): Promise<ComfyOptions> {
    this.assertAvailable();
    return this.active.getOptions();
  }

  getQueue(): Promise<ComfyQueue> {
    this.assertAvailable();
    return this.active.getQueue();
  }

  getHistory(promptId: string): Promise<ComfyHistory> {
    this.assertAvailable();
    return this.active.getHistory(promptId);
  }

  uploadImage(input: UploadImageInput): Promise<UploadedImage> {
    this.assertAvailable();
    return this.active.uploadImage(input);
  }

  queuePrompt(
    prompt: ComfyPrompt,
    clientId: string,
    extraData?: Record<string, unknown>,
  ): Promise<QueuePromptResult> {
    this.assertAvailable();
    return this.active.queuePrompt(prompt, clientId, extraData);
  }

  downloadOutput(ref: ComfyImageRef): Promise<DownloadedOutput> {
    this.assertAvailable();
    return this.active.downloadOutput(ref);
  }

  cancelQueued(promptId: string): Promise<void> {
    this.assertAvailable();
    return this.active.cancelQueued(promptId);
  }

  interrupt(): Promise<void> {
    this.assertAvailable();
    return this.active.interrupt();
  }

  free(): Promise<void> {
    this.assertAvailable();
    return this.active.free?.() ?? Promise.resolve();
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
    if (!this.enabled) return { close() {} };
    return this.active.connect(clientId, handlers);
  }
}
