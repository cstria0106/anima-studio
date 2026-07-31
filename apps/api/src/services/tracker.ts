import type { JobPhase } from "@anima/shared";
import type {
  ComfyClientLike,
  SocketHandle,
} from "../comfy/client";
import type {
  ComfyHistoryEntry,
  ComfyImageRef,
  ComfyPreviewFrame,
  ComfyQueue,
  ComfySocketEvent,
} from "../comfy/types";
import { StudioRepository } from "../db/repository";
import type { JobRow } from "../db/schema";
import { FileStorage } from "../files/storage";
import { JobEventService } from "./job-events";

const phaseLabels: Record<JobPhase, string> = {
  preparing: "준비",
  uploading: "이미지 업로드",
  queued: "대기열",
  loading_models: "모델 로딩",
  training: "태깅 및 Instant LoRA 학습",
  encoding: "프롬프트 인코딩",
  sampling: "기본 이미지 생성",
  upscaling: "업스케일 이미지 생성",
  saving: "결과 저장",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

function queuePromptIds(tuples: unknown[][]): string[] {
  return tuples.flatMap((tuple) =>
    typeof tuple[1] === "string" ? [tuple[1]] : [],
  );
}

function eventNodeId(event: ComfySocketEvent): string | null {
  if (typeof event.data?.node === "string") return event.data.node;
  const nodeId = event.data?.node_id;
  return typeof nodeId === "string" ? nodeId : null;
}

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return ["text", "string", "value", "tags"].flatMap((key) =>
    textValues(record[key]),
  );
}

function outputFileRefs(value: unknown): ComfyImageRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.filename !== "string") return [];
    return [
      {
        filename: record.filename,
        subfolder:
          typeof record.subfolder === "string" ? record.subfolder : "",
        type: typeof record.type === "string" ? record.type : "output",
      },
    ];
  });
}

function historyFailure(
  entry: ComfyHistoryEntry,
): { message: string; nodeId: string | null } | null {
  const messages = entry.status?.messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const data =
      message[1] && typeof message[1] === "object"
        ? (message[1] as Record<string, unknown>)
        : {};
    return {
      message:
        typeof data.exception_message === "string"
          ? data.exception_message
          : "ComfyUI execution failed.",
      nodeId: typeof data.node_id === "string" ? data.node_id : null,
    };
  }
  if (
    entry.status?.completed === false &&
    entry.status?.status_str === "error"
  ) {
    return { message: "ComfyUI execution failed.", nodeId: null };
  }
  return null;
}

export interface JobTrackerOptions {
  queuePollMs: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class JobTracker {
  private socket: SocketHandle | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private polling = false;
  private reconnectAttempt = 0;
  private finishing = new Set<string>();
  private eventChain: Promise<void> = Promise.resolve();
  private previewRevisions = new Map<string, number>();
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  connected = false;

  get running(): boolean {
    return !this.stopped;
  }

  constructor(
    private readonly repository: StudioRepository,
    private readonly storage: FileStorage,
    private readonly comfy: ComfyClientLike,
    private readonly events: JobEventService,
    private readonly clientId: string,
    private readonly options: JobTrackerOptions,
  ) {
    this.logger = options.logger ?? console;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.reconcileStartup();
    this.openSocket();
    this.pollTimer = setInterval(() => void this.pollQueue(), this.options.queuePollMs);
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.storage.clearPreviews();
    this.previewRevisions.clear();
  }

  async reconnect(): Promise<void> {
    this.stop();
    await this.start();
  }

  async refreshJob(_jobId: string): Promise<void> {
    await this.pollQueue();
  }

  private openSocket(): void {
    if (this.stopped || this.socket) return;
    try {
      this.socket = this.comfy.connect(this.clientId, {
        onOpen: () => {
          this.connected = true;
          this.reconnectAttempt = 0;
          this.logger.info("Connected to ComfyUI progress WebSocket.");
        },
        onClose: () => {
          this.connected = false;
          this.socket = null;
          this.scheduleReconnect();
        },
        onError: (error) => {
          this.logger.warn("ComfyUI WebSocket error.", error);
        },
        onEvent: (event) => {
          this.eventChain = this.eventChain
            .then(() => this.handleEvent(event))
            .catch((error) => {
              this.logger.error("Could not process ComfyUI event.", error);
            });
        },
        onPreview: (frame) => {
          this.eventChain = this.eventChain
            .then(() => this.handlePreview(frame))
            .catch((error) => {
              this.logger.warn("Could not process ComfyUI preview.", error);
            });
        },
      });
    } catch (error) {
      this.socket = null;
      this.logger.warn("Could not open ComfyUI WebSocket.", error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private async reconcileStartup(): Promise<void> {
    const active = this.repository.listActiveJobRows();
    for (const row of active) {
      if (!row.comfyPromptId) {
        this.fail(
          row,
          "API 서버가 재시작되기 전에 ComfyUI 제출이 완료되지 않았습니다.",
        );
      }
    }
    await this.pollQueue();
  }

  private async pollQueue(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const queue = await this.comfy.getQueue();
      await this.applyQueue(queue);
    } catch (error) {
      this.logger.warn("Could not reconcile the ComfyUI queue.", error);
    } finally {
      this.polling = false;
    }
  }

  private async applyQueue(queue: ComfyQueue): Promise<void> {
    const running = queuePromptIds(queue.queue_running);
    const pending = queuePromptIds(queue.queue_pending);
    const runningSet = new Set(running);
    const pendingPosition = new Map(
      pending.map((promptId, index) => [promptId, index + 1]),
    );

    for (const row of this.repository.listActiveJobRows()) {
      const promptId = row.comfyPromptId;
      if (!promptId) continue;
      if (runningSet.has(promptId)) {
        if (row.status !== "running") {
          const now = new Date().toISOString();
          this.repository.updateJob(row.id, {
            status: "running",
            phase: "loading_models",
            queueNumber: null,
            startedAt: row.startedAt ?? now,
          });
          this.events.append({
            jobId: row.id,
            phase: "loading_models",
            message: "ComfyUI가 작업 실행을 시작했습니다.",
            progress: null,
          });
        }
        continue;
      }

      const position = pendingPosition.get(promptId);
      if (position !== undefined) {
        if (
          row.status !== "queued" ||
          row.queueNumber !== position ||
          row.phase !== "queued"
        ) {
          this.repository.updateJob(row.id, {
            status: "queued",
            phase: "queued",
            queueNumber: position,
          });
          this.events.append({
            jobId: row.id,
            phase: "queued",
            message: `대기열 ${position}번째입니다.`,
            progress: null,
            current: position,
          });
        }
        continue;
      }

      const history = await this.comfy.getHistory(promptId);
      if (history[promptId]) {
        await this.finalize(row.id, history[promptId]!);
      }
    }
  }

  private async handleEvent(event: ComfySocketEvent): Promise<void> {
    const promptId = event.data?.prompt_id;
    if (!promptId) {
      if (event.type === "status") await this.pollQueue();
      return;
    }
    const row = this.repository.findJobByPromptId(promptId);
    if (!row || this.repository.isTerminal(row)) return;

    switch (event.type) {
      case "execution_start":
        this.markRunning(row);
        break;
      case "executing":
        if (event.data?.node === null) {
          await this.finalize(row.id);
        } else if (typeof event.data?.node === "string") {
          this.markNode(row, event.data.node);
        }
        break;
      case "progress":
        this.markProgress(row, event);
        break;
      case "executed":
        if (event.data?.node === row.autoTagsNodeId) {
          const tags = textValues(event.data.output).join(", ").trim();
          if (tags) this.repository.updateJob(row.id, { autoTags: tags });
        }
        break;
      case "execution_success":
        await this.finalize(row.id);
        break;
      case "execution_error":
        this.failFromEvent(row, event);
        break;
      case "execution_interrupted":
        this.fail(row, "ComfyUI 실행이 중단되었습니다.");
        break;
      case "status":
        await this.pollQueue();
        break;
    }
  }

  private markRunning(row: JobRow): void {
    if (row.status === "running") return;
    this.repository.updateJob(row.id, {
      status: "running",
      phase: "loading_models",
      queueNumber: null,
      startedAt: row.startedAt ?? new Date().toISOString(),
    });
    this.events.append({
      jobId: row.id,
      phase: "loading_models",
      message: "ComfyUI가 작업 실행을 시작했습니다.",
      progress: null,
    });
  }

  private markNode(row: JobRow, nodeId: string): void {
    const phase = this.repository.parseNodePhases(row)[nodeId];
    if (!phase) return;
    const label =
      this.repository.parseNodeLabels(row)[nodeId] ?? phaseLabels[phase];
    const current = this.repository.findJobRow(row.id);
    if (!current || current.phase === phase) return;
    this.repository.updateJob(row.id, {
      status: "running",
      phase,
      startedAt: current.startedAt ?? new Date().toISOString(),
    });
    this.events.append({
      jobId: row.id,
      phase,
      message: label,
      progress: null,
      payload: { nodeId },
    });
  }

  private markProgress(row: JobRow, event: ComfySocketEvent): void {
    const current = event.data?.value;
    const total = event.data?.max;
    if (
      typeof current !== "number" ||
      typeof total !== "number" ||
      total <= 0
    ) {
      return;
    }
    const nodeId = eventNodeId(event);
    const phase =
      (nodeId ? this.repository.parseNodePhases(row)[nodeId] : null) ??
      (row.phase as JobPhase);
    const progress = Math.max(
      0,
      Math.min(100, Math.round((current / total) * 100)),
    );
    this.repository.updateJob(row.id, {
      status: "running",
      phase,
      startedAt: row.startedAt ?? new Date().toISOString(),
    });
    this.events.append({
      jobId: row.id,
      phase,
      message: `${phaseLabels[phase]} ${current}/${total}`,
      progress,
      current,
      total,
      payload: nodeId ? { nodeId } : undefined,
    });
  }

  private async handlePreview(frame: ComfyPreviewFrame): Promise<void> {
    if (!frame.promptId) return;
    const row = this.repository.findJobByPromptId(frame.promptId);
    if (!row || this.repository.isTerminal(row)) return;
    const phase =
      (frame.nodeId
        ? this.repository.parseNodePhases(row)[frame.nodeId]
        : null) ?? (row.phase as JobPhase);
    if (phase !== "sampling" && phase !== "upscaling") return;

    const stored = await this.storage.storePreview(
      row.id,
      frame.bytes,
      frame.mimeType,
    );
    const priorRevision =
      this.previewRevisions.get(row.id) ??
      this.repository.latestPreview(row.id)?.revision ??
      0;
    const revision = priorRevision + 1;
    this.previewRevisions.set(row.id, revision);
    const updatedAt = new Date().toISOString();
    const step =
      typeof frame.step === "number" && Number.isFinite(frame.step)
        ? frame.step
        : null;
    const total =
      typeof frame.total === "number" &&
      Number.isFinite(frame.total) &&
      frame.total > 0
        ? frame.total
        : null;
    const progress =
      step !== null && total !== null
        ? Math.max(0, Math.min(100, Math.round((step / total) * 100)))
        : null;
    this.events.append({
      jobId: row.id,
      phase,
      message:
        step !== null && total !== null
          ? `${phaseLabels[phase]} 미리보기 ${step}/${total}`
          : `${phaseLabels[phase]} 미리보기`,
      progress,
      current: step,
      total,
      payload: {
        preview: {
          url: `/api/jobs/${encodeURIComponent(row.id)}/preview?v=${revision}`,
          mimeType: stored.mimeType,
          revision,
          step,
          total,
          updatedAt,
        },
        ...(frame.nodeId ? { nodeId: frame.nodeId } : {}),
      },
      createdAt: updatedAt,
    });
  }

  private failFromEvent(row: JobRow, event: ComfySocketEvent): void {
    const nodeId = eventNodeId(event);
    const label = nodeId
      ? this.repository.parseNodeLabels(row)[nodeId]
      : undefined;
    const detail =
      event.data?.exception_message ??
      event.data?.exception_type ??
      "ComfyUI execution failed.";
    this.fail(row, label ? `${label}: ${detail}` : String(detail));
  }

  private fail(row: JobRow, message: string): void {
    const current = this.repository.findJobRow(row.id);
    if (!current || this.repository.isTerminal(current)) return;
    this.repository.updateJob(row.id, {
      status: "failed",
      phase: "failed",
      queueNumber: null,
      error: message,
      completedAt: new Date().toISOString(),
    });
    this.storage.deletePreview(row.id);
    this.previewRevisions.delete(row.id);
    this.events.append({
      jobId: row.id,
      phase: "failed",
      message,
      progress: null,
    });
  }

  private async loadHistory(
    promptId: string,
  ): Promise<ComfyHistoryEntry | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const history = await this.comfy.getHistory(promptId);
      const entry = history[promptId];
      if (entry) return entry;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    return null;
  }

  private async extractAutoTags(
    row: JobRow,
    entry: ComfyHistoryEntry,
  ): Promise<string> {
    if (!row.autoTagsNodeId) return row.autoTags;
    const output = entry.outputs?.[row.autoTagsNodeId];
    const inline = textValues(output).join(", ").trim();
    if (inline) return inline;

    if (output && typeof output === "object") {
      const record = output as Record<string, unknown>;
      const refs = [
        ...outputFileRefs(record.files),
        ...outputFileRefs(record.text_files),
      ];
      for (const ref of refs) {
        try {
          const file = await this.comfy.downloadOutput(ref);
          const text = new TextDecoder().decode(file.bytes).trim();
          if (text) return text;
        } catch (error) {
          this.logger.warn("Could not download automatic tag output.", error);
        }
      }
    }
    return row.autoTags;
  }

  private async finalize(
    jobId: string,
    suppliedEntry?: ComfyHistoryEntry,
  ): Promise<void> {
    if (this.finishing.has(jobId)) return;
    this.finishing.add(jobId);
    try {
      const row = this.repository.findJobRow(jobId);
      if (!row || this.repository.isTerminal(row) || !row.comfyPromptId) return;
      const entry =
        suppliedEntry ?? (await this.loadHistory(row.comfyPromptId));
      if (!entry) return;

      const failure = historyFailure(entry);
      if (failure) {
        const label = failure.nodeId
          ? this.repository.parseNodeLabels(row)[failure.nodeId]
          : null;
        this.fail(row, label ? `${label}: ${failure.message}` : failure.message);
        return;
      }

      this.repository.updateJob(jobId, {
        status: "running",
        phase: "saving",
        queueNumber: null,
      });
      this.events.append({
        jobId,
        phase: "saving",
        message: "생성 결과를 앱 저장소에 보존하고 있습니다.",
        progress: null,
      });

      const outputKinds = this.repository.parseOutputKinds(row);
      const existing = new Set(
        this.repository
          .listOutputs(jobId)
          .map(
            (output) =>
              `${output.nodeId}\0${output.comfySubfolder}\0${output.comfyFilename}`,
          ),
      );
      let imageCount = existing.size;
      for (const [nodeId, kind] of Object.entries(outputKinds)) {
        const output = entry.outputs?.[nodeId];
        const refs = [
          ...(output?.images ?? []),
          ...(output?.gifs ?? []),
        ];
        for (const ref of refs) {
          const key = `${nodeId}\0${ref.subfolder ?? ""}\0${ref.filename}`;
          if (existing.has(key)) continue;
          const downloaded = await this.comfy.downloadOutput(ref);
          await this.storage.storeOutput({
            jobId,
            kind,
            nodeId,
            comfyFilename: ref.filename,
            comfySubfolder: ref.subfolder ?? "",
            comfyType: ref.type ?? "output",
            bytes: downloaded.bytes,
            contentType: downloaded.contentType,
          });
          existing.add(key);
          imageCount += 1;
        }
      }

      if (imageCount === 0) {
        this.fail(row, "ComfyUI execution completed without an image output.");
        return;
      }
      const autoTags = await this.extractAutoTags(row, entry);
      const completedAt = new Date().toISOString();
      this.repository.updateJob(jobId, {
        status: "completed",
        phase: "completed",
        queueNumber: null,
        autoTags,
        error: null,
        completedAt,
      });
      this.storage.deletePreview(jobId);
      this.previewRevisions.delete(jobId);
      this.events.append({
        jobId,
        phase: "completed",
        message: `${imageCount}개의 결과 이미지를 저장했습니다.`,
        progress: 100,
        current: imageCount,
        total: imageCount,
      });
    } catch (error) {
      const row = this.repository.findJobRow(jobId);
      if (row) {
        this.fail(
          row,
          error instanceof Error
            ? `결과 저장 실패: ${error.message}`
            : "결과 저장에 실패했습니다.",
        );
      }
    } finally {
      this.finishing.delete(jobId);
    }
  }
}
