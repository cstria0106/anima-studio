import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import type {
  HuggingFaceAnimaCatalogDto,
  HuggingFaceAnimaDownloadCreate,
  HuggingFaceAnimaFileDto,
  HuggingFaceAnimaInstallDto,
  HuggingFaceAnimaProviderStatusDto,
  ModelDownloadDto,
  ModelDownloadState,
} from "@anima/shared";

import type {
  ModelDownloadPatch,
  NewModelDownload,
} from "../db/repository";
import type {
  VerifiedFileDownload,
  VerifiedFileDownloader,
} from "../runtime/download";
import { sha256File } from "../runtime/download";
import type {
  ModelDownloadOperations,
  ModelDownloadPersistence,
} from "../civitai/service";
import { DestinationRegistry } from "../civitai/destinations";
import {
  HUGGING_FACE_ANIMA_REPOSITORY,
  HuggingFaceAnimaClient,
} from "./client";
import {
  HuggingFaceError,
  assertHuggingFace,
} from "./errors";

const encoderPath =
  "split_files/text_encoders/qwen_3_06b_base.safetensors";
const vaePath = "split_files/vae/qwen_image_vae.safetensors";
const terminalStates = new Set<ModelDownloadState>([
  "completed",
  "failed",
  "cancelled",
]);
const interruptedDownloadMessage =
  "API가 종료되어 Hugging Face 다운로드가 중단되었습니다. 다시 시도해 주세요.";

interface DownloadTask {
  id: string;
  operationId: string;
  catalog: HuggingFaceAnimaCatalogDto;
  file: HuggingFaceAnimaFileDto;
  destination: ReturnType<DestinationRegistry["resolveKind"]>;
  artifact: VerifiedFileDownload;
  metadata: Record<string, unknown>;
  stagingDirectory: string;
}

interface PreparedDownload {
  catalog: HuggingFaceAnimaCatalogDto;
  file: HuggingFaceAnimaFileDto;
  destination: ReturnType<DestinationRegistry["resolveKind"]>;
  targetPath: string;
  reusable: ModelDownloadDto | null;
  locallyInstalled: boolean;
}

interface ActiveRun {
  id: string;
  controller: AbortController;
  completion: Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

export interface HuggingFaceDownloadClock {
  now(): string;
  milliseconds(): number;
}

const systemClock: HuggingFaceDownloadClock = {
  now: () => new Date().toISOString(),
  milliseconds: () => Date.now(),
};

function deferred(): Deferred {
  let settle: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => settle?.(),
  };
}

function safeFailure(error: unknown): HuggingFaceError {
  if (error instanceof HuggingFaceError) return error;
  return new HuggingFaceError(
    "DOWNLOAD_FAILED",
    "Hugging Face Anima 모델 다운로드에 실패했습니다.",
    500,
  );
}

function comfyModelPath(absoluteRoot: string, finalPath: string): string {
  const pathFromRoot = relative(resolve(absoluteRoot), resolve(finalPath));
  assertHuggingFace(
    pathFromRoot.length > 0 &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !pathFromRoot.includes(`..${sep}`) &&
      !pathFromRoot.startsWith(sep),
    "DOWNLOAD_FAILED",
    "다운로드된 모델이 관리형 모델 폴더 밖에 있습니다.",
    502,
  );
  return pathFromRoot.split(sep).join("/");
}

function taskId(file: HuggingFaceAnimaFileDto): string {
  return `hf-anima-${file.sha256.slice(0, 20)}`;
}

async function regularFileSize(path: string): Promise<number | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new HuggingFaceError(
        "DOWNLOAD_CONFLICT",
        `${basename(path)}과 같은 이름의 다른 항목이 이미 있습니다.`,
        409,
      );
    }
    return info.size;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export class HuggingFaceAnimaLibraryService {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly queue: string[] = [];
  private readonly completions = new Map<string, Deferred>();
  private readonly paused = new Set<string>();
  private readonly cancelled = new Set<string>();
  private active: ActiveRun | null = null;
  private shuttingDown = false;

  constructor(
    private readonly client: HuggingFaceAnimaClient,
    private readonly downloader: VerifiedFileDownloader,
    private readonly destinations: DestinationRegistry,
    private readonly persistence: ModelDownloadPersistence,
    private readonly operations: ModelDownloadOperations,
    private readonly clock: HuggingFaceDownloadClock = systemClock,
    private readonly progressIntervalMs = 600,
  ) {}

  providerStatus(
    managedDownloads: boolean,
    reason?: string,
  ): HuggingFaceAnimaProviderStatusDto {
    return {
      provider: "huggingface",
      available: managedDownloads,
      repository: HUGGING_FACE_ANIMA_REPOSITORY,
      managedDownloads,
      supportedFormats: [".safetensors"],
      destinations: this.destinations
        .options()
        .filter((option) =>
          ["diffusion_models", "text_encoders", "vae"].includes(
            option.kind,
          ),
        )
        .map((option) => ({
          id: option.kind,
          label: option.label,
          kind: option.kind,
        })),
      ...(reason ? { reason } : {}),
    };
  }

  catalog(): Promise<HuggingFaceAnimaCatalogDto> {
    return this.client.catalog();
  }

  get(id: string): ModelDownloadDto {
    const download = this.persistence.findModelDownload(id);
    if (!download || download.provider !== "huggingface") {
      throw new HuggingFaceError(
        "DOWNLOAD_NOT_FOUND",
        "Hugging Face 모델 다운로드를 찾을 수 없습니다.",
        404,
      );
    }
    return download;
  }

  list(limit = 50): ModelDownloadDto[] {
    return this.persistence.listModelDownloads(
      Math.min(Math.max(limit, 1), 100),
      "huggingface",
    );
  }

  async install(
    input: HuggingFaceAnimaDownloadCreate,
  ): Promise<HuggingFaceAnimaInstallDto> {
    assertHuggingFace(
      input.acceptedLicense === true,
      "LICENSE_REQUIRED",
      "Anima 비상업 라이선스를 확인해야 다운로드할 수 있습니다.",
      400,
    );
    assertHuggingFace(
      !this.shuttingDown,
      "DOWNLOAD_FAILED",
      "모델 다운로드 서비스가 종료 중입니다.",
      409,
    );
    const catalog = await this.client.catalog(input.revision);
    const selected = catalog.files.find((file) => file.path === input.path);
    assertHuggingFace(
      selected?.kind === "diffusion_model",
      "INVALID_FILE",
      "Anima Diffusion 모델을 선택해 주세요.",
    );
    const files = [selected];
    if (input.includeDependencies) {
      for (const path of [encoderPath, vaePath]) {
        const dependency = catalog.files.find((file) => file.path === path);
        assertHuggingFace(
          dependency,
          "CATALOG_INCOMPATIBLE",
          "Anima 공용 Text Encoder 또는 VAE를 찾지 못했습니다.",
          502,
        );
        files.push(dependency);
      }
    }

    // Validate every destination before queuing any part of the model bundle.
    // In particular, a conflicting shared dependency must not leave the
    // selected diffusion model running as a partial install.
    const prepared: PreparedDownload[] = [];
    for (const file of files) {
      prepared.push(await this.prepareDownload(catalog, file));
    }
    const downloads: ModelDownloadDto[] = [];
    const alreadyInstalled: string[] = [];
    for (const item of prepared) {
      const result = this.ensureDownload(item);
      if (result.created) downloads.push(result.download);
      else {
        downloads.push(result.download);
        if (result.download.state === "completed") {
          alreadyInstalled.push(item.file.filename);
        }
      }
    }
    return { downloads, alreadyInstalled };
  }

  async pause(id: string): Promise<ModelDownloadDto> {
    const download = this.get(id);
    assertHuggingFace(
      download.state === "queued" || download.state === "downloading",
      "DOWNLOAD_FAILED",
      "대기 중이거나 다운로드 중인 항목만 일시정지할 수 있습니다.",
      409,
    );
    this.paused.add(id);
    this.queue.splice(0, this.queue.length, ...this.queue.filter((x) => x !== id));
    if (this.active?.id === id) {
      this.active.controller.abort();
      await this.active.completion;
    }
    this.persistence.updateModelDownload(id, {
      state: "paused",
      bytesPerSecond: 0,
    });
    this.operations.report(download.operationId, {
      phase: "paused",
      message: "Hugging Face 모델 다운로드를 일시정지했습니다.",
      status: "running",
      bytesCompleted: download.bytesCompleted,
      bytesTotal: download.bytesTotal,
      bytesPerSecond: 0,
    });
    return this.get(id);
  }

  resume(id: string): ModelDownloadDto {
    const download = this.get(id);
    assertHuggingFace(
      download.state === "paused" && this.tasks.has(id),
      "DOWNLOAD_FAILED",
      "일시정지된 다운로드만 다시 시작할 수 있습니다.",
      409,
    );
    this.paused.delete(id);
    this.persistence.updateModelDownload(id, {
      state: "queued",
      bytesPerSecond: 0,
    });
    this.operations.report(download.operationId, {
      phase: "queued",
      message: "Hugging Face 모델 다운로드를 다시 대기열에 추가했습니다.",
      status: "running",
      bytesCompleted: download.bytesCompleted,
      bytesTotal: download.bytesTotal,
      bytesPerSecond: 0,
    });
    this.enqueue(id);
    return this.get(id);
  }

  async cancel(id: string): Promise<ModelDownloadDto> {
    const download = this.get(id);
    assertHuggingFace(
      !terminalStates.has(download.state),
      "DOWNLOAD_FAILED",
      "이미 끝난 다운로드는 취소할 수 없습니다.",
      409,
    );
    this.cancelled.add(id);
    this.queue.splice(0, this.queue.length, ...this.queue.filter((x) => x !== id));
    if (this.active?.id === id) {
      this.active.controller.abort();
      await this.active.completion;
    }
    const task = this.tasks.get(id);
    if (task) await this.removeStaging(task);
    this.persistence.updateModelDownload(id, {
      state: "cancelled",
      bytesPerSecond: 0,
      error: null,
      completedAt: this.clock.now(),
    });
    this.operations.cancel(
      download.operationId,
      "Hugging Face 모델 다운로드를 취소했습니다.",
    );
    this.finish(id);
    return this.get(id);
  }

  async retry(id: string): Promise<ModelDownloadDto> {
    const previous = this.get(id);
    assertHuggingFace(
      previous.state === "failed" || previous.state === "cancelled",
      "DOWNLOAD_FAILED",
      "실패했거나 취소한 다운로드만 다시 시도할 수 있습니다.",
      409,
    );
    const catalog = await this.client.catalog(previous.providerVersionId);
    const file = catalog.files.find(
      (candidate) => candidate.path === previous.providerFileId,
    );
    assertHuggingFace(
      file,
      "INVALID_FILE",
      "이전 Anima 파일 선택을 현재 revision에서 찾지 못했습니다.",
      409,
    );
    const prepared = await this.prepareDownload(catalog, file);
    const result = await this.ensureDownload(
      prepared,
      previous.id,
    );
    return result.download;
  }

  async settled(id: string): Promise<ModelDownloadDto> {
    await this.completions.get(id)?.promise;
    return this.get(id);
  }

  reconcileInterruptedDownloads(): ModelDownloadDto[] {
    const completedAt = this.clock.now();
    const reconciled: ModelDownloadDto[] = [];
    for (const download of this.persistence.listIncompleteModelDownloads(
      "huggingface",
    )) {
      const updated = this.persistence.updateModelDownload(download.id, {
        state: "failed",
        bytesPerSecond: 0,
        error: interruptedDownloadMessage,
        metadata: {
          ...download.metadata,
          interrupted: true,
          interruptedAt: completedAt,
        },
        completedAt,
      });
      if (!updated) continue;
      reconciled.push(updated);
      try {
        this.operations.fail(
          download.operationId,
          new Error(interruptedDownloadMessage),
          "interrupted",
        );
      } catch {
        // The durable download row remains authoritative.
      }
    }
    return reconciled;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.active?.controller.abort();
    await this.active?.completion;
  }

  private async prepareDownload(
    catalog: HuggingFaceAnimaCatalogDto,
    file: HuggingFaceAnimaFileDto,
  ): Promise<PreparedDownload> {
    const destination = this.destinations.resolveKind(
      file.destinationRootId,
      file.destinationRootId,
    );
    const targetPath = this.destinations.assertFinalFile(
      destination,
      join(destination.absoluteDirectory, file.filename),
    );
    const matches = this.persistence.listModelDownloadsByProviderFile(
      "huggingface",
      HUGGING_FACE_ANIMA_REPOSITORY,
      catalog.revision,
      file.path,
    );
    const active = matches.find(
      (download) => !terminalStates.has(download.state),
    );
    if (active) {
      return {
        catalog,
        file,
        destination,
        targetPath,
        reusable: active,
        locallyInstalled: false,
      };
    }

    const existingSize = await regularFileSize(targetPath);
    if (existingSize === null) {
      return {
        catalog,
        file,
        destination,
        targetPath,
        reusable: null,
        locallyInstalled: false,
      };
    }
    if (
      existingSize !== file.sizeBytes ||
      (await sha256File(targetPath)) !== file.sha256
    ) {
      throw new HuggingFaceError(
        "DOWNLOAD_CONFLICT",
        `${file.filename}과 같은 이름의 다른 파일이 이미 있습니다.`,
        409,
      );
    }
    return {
      catalog,
      file,
      destination,
      targetPath,
      reusable:
        matches.find((download) => download.state === "completed") ?? null,
      locallyInstalled: true,
    };
  }

  private ensureDownload(
    prepared: PreparedDownload,
    retryOf?: string,
  ): { download: ModelDownloadDto; created: boolean } {
    const { catalog, file, destination } = prepared;
    const concurrent = this.persistence
      .listModelDownloadsByProviderFile(
        "huggingface",
        HUGGING_FACE_ANIMA_REPOSITORY,
        catalog.revision,
        file.path,
      )
      .find(
        (download) =>
          !terminalStates.has(download.state) ||
          (prepared.locallyInstalled &&
            download.state === "completed"),
      );
    const existing = concurrent ?? prepared.reusable;
    if (existing) {
      return { download: existing, created: false };
    }

    const operation = this.operations.create(
      "model_download",
      "resolving",
      "Hugging Face Anima 모델을 확인하고 있습니다.",
      {
        provider: "huggingface",
        repository: HUGGING_FACE_ANIMA_REPOSITORY,
        revision: catalog.revision,
        path: file.path,
        destinationRootId: file.destinationRootId,
        ...(retryOf ? { retryOf } : {}),
      },
    );
    const id = crypto.randomUUID();
    const metadata: Record<string, unknown> = {
      sourceUrl: catalog.sourceUrl,
      repository: catalog.repository,
      revision: catalog.revision,
      remotePath: file.path,
      license: catalog.license,
      licenseUrl: catalog.licenseUrl,
      modelKind: file.kind,
      ...(retryOf ? { retryOf } : {}),
    };
    const artifact: VerifiedFileDownload = {
      id: taskId(file),
      downloadUrl: this.client.downloadUrl(catalog.revision, file.path),
      filename: `${taskId(file)}.blob`,
      bytes: file.sizeBytes,
      sha256: file.sha256,
    };
    const stagingDirectory = join(
      destination.absoluteDirectory,
      ".anima-downloads",
    );
    let created = this.persistence.createModelDownload({
      id,
      operationId: operation.id,
      state: prepared.locallyInstalled ? "completed" : "queued",
      provider: "huggingface",
      providerDownloadId: id,
      providerModelId: HUGGING_FACE_ANIMA_REPOSITORY,
      providerVersionId: catalog.revision,
      providerFileId: file.path,
      modelName: "CircleStone Labs Anima",
      versionName: catalog.revision.slice(0, 12),
      filename: file.filename,
      destinationRootId: file.destinationRootId,
      expectedSha256: file.sha256,
      bytesTotal: file.sizeBytes,
      metadata,
      createdAt: this.clock.now(),
    });
    if (prepared.locallyInstalled) {
      const completedAt = this.clock.now();
      const completedMetadata = {
        ...metadata,
        comfyModelPath: comfyModelPath(
          destination.absoluteRoot,
          prepared.targetPath,
        ),
        indexedExistingFile: true,
      };
      created =
        this.persistence.updateModelDownload(id, {
          state: "completed",
          actualSha256: file.sha256,
          bytesCompleted: file.sizeBytes,
          bytesTotal: file.sizeBytes,
          bytesPerSecond: 0,
          storagePath: prepared.targetPath,
          metadata: completedMetadata,
          error: null,
          completedAt,
        }) ?? created;
      this.operations.start(
        operation.id,
        "indexing",
        "이미 설치된 Anima 모델을 등록하고 있습니다.",
      );
      this.operations.complete(
        operation.id,
        "completed",
        "이미 설치된 Anima 모델을 확인했습니다.",
        {
          ...completedMetadata,
          filename: file.filename,
          sha256: file.sha256,
        },
      );
      return { download: created, created: false };
    }
    this.operations.start(
      operation.id,
      "queued",
      "Hugging Face 모델 다운로드를 대기열에 추가했습니다.",
    );
    this.tasks.set(id, {
      id,
      operationId: operation.id,
      catalog,
      file,
      destination,
      artifact,
      metadata,
      stagingDirectory,
    });
    this.completions.set(id, deferred());
    this.enqueue(id);
    return { download: created, created: true };
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.active || this.shuttingDown) return;
    const id = this.queue.shift();
    if (!id) return;
    const task = this.tasks.get(id);
    if (!task || this.paused.has(id) || this.cancelled.has(id)) {
      void this.pump();
      return;
    }
    const controller = new AbortController();
    const completion = this.execute(task, controller.signal);
    this.active = { id, controller, completion };
    await completion;
    if (this.active?.id === id) this.active = null;
    void this.pump();
  }

  private async execute(
    task: DownloadTask,
    signal: AbortSignal,
  ): Promise<void> {
    let lastReportAt = this.clock.milliseconds();
    let lastBytes = this.get(task.id).bytesCompleted;
    try {
      this.persistence.updateModelDownload(task.id, {
        state: "downloading",
        bytesPerSecond: 0,
      });
      this.operations.report(task.operationId, {
        phase: "downloading",
        message: "Hugging Face에서 Anima 모델을 다운로드하고 있습니다.",
        status: "running",
        progress: (lastBytes / task.file.sizeBytes) * 100,
        bytesCompleted: lastBytes,
        bytesTotal: task.file.sizeBytes,
      });
      const stagedPath = await this.downloader.download(
        task.artifact,
        task.stagingDirectory,
        {
          signal,
          onProgress: (progress) => {
            const now = this.clock.milliseconds();
            const elapsed = now - lastReportAt;
            if (
              elapsed < this.progressIntervalMs &&
              progress.currentBytes !== progress.totalBytes
            ) {
              return;
            }
            const bytesPerSecond =
              elapsed > 0
                ? Math.round(
                    ((progress.currentBytes - lastBytes) * 1_000) /
                      elapsed,
                  )
                : 0;
            lastReportAt = now;
            lastBytes = progress.currentBytes;
            this.persistence.updateModelDownload(task.id, {
              state: "downloading",
              bytesCompleted: progress.currentBytes,
              bytesTotal: progress.totalBytes,
              bytesPerSecond,
            });
            this.operations.report(task.operationId, {
              phase: "downloading",
              message:
                "Hugging Face에서 Anima 모델을 다운로드하고 있습니다.",
              status: "running",
              progress:
                (progress.currentBytes / progress.totalBytes) * 100,
              bytesCompleted: progress.currentBytes,
              bytesTotal: progress.totalBytes,
              bytesPerSecond,
            });
          },
        },
      );
      if (
        signal.aborted ||
        this.paused.has(task.id) ||
        this.cancelled.has(task.id) ||
        this.shuttingDown
      ) {
        return;
      }

      this.persistence.updateModelDownload(task.id, {
        state: "verifying",
        bytesCompleted: task.file.sizeBytes,
        bytesTotal: task.file.sizeBytes,
        bytesPerSecond: 0,
      });
      this.operations.report(task.operationId, {
        phase: "verifying",
        message: "고정된 Git LFS SHA-256을 확인했습니다.",
        status: "running",
        progress: 99,
        bytesCompleted: task.file.sizeBytes,
        bytesTotal: task.file.sizeBytes,
        bytesPerSecond: 0,
      });

      await mkdir(task.destination.absoluteDirectory, {
        recursive: true,
      });
      const targetPath = this.destinations.assertFinalFile(
        task.destination,
        join(task.destination.absoluteDirectory, task.file.filename),
      );
      const existingSize = await regularFileSize(targetPath);
      if (existingSize !== null) {
        const existingHash =
          existingSize === task.file.sizeBytes
            ? await sha256File(targetPath)
            : null;
        if (existingHash !== task.file.sha256) {
          throw new HuggingFaceError(
            "DOWNLOAD_CONFLICT",
            `${task.file.filename}과 같은 이름의 다른 파일이 이미 있습니다.`,
            409,
          );
        }
        await rm(stagedPath, { force: true });
      } else {
        await rename(stagedPath, targetPath);
      }
      const finalSize = (await stat(targetPath)).size;
      assertHuggingFace(
        finalSize === task.file.sizeBytes,
        "DOWNLOAD_FAILED",
        "설치된 Anima 모델 크기가 예상과 다릅니다.",
        502,
      );
      const completedAt = this.clock.now();
      const completedMetadata = {
        ...task.metadata,
        comfyModelPath: comfyModelPath(
          task.destination.absoluteRoot,
          targetPath,
        ),
      };
      this.persistence.updateModelDownload(task.id, {
        state: "completed",
        filename: basename(targetPath),
        actualSha256: task.file.sha256,
        bytesCompleted: task.file.sizeBytes,
        bytesTotal: task.file.sizeBytes,
        bytesPerSecond: 0,
        storagePath: targetPath,
        metadata: completedMetadata,
        error: null,
        completedAt,
      });
      this.operations.complete(
        task.operationId,
        "completed",
        "Hugging Face Anima 모델 설치를 완료했습니다.",
        {
          ...completedMetadata,
          filename: task.file.filename,
          sha256: task.file.sha256,
        },
      );
      this.finish(task.id);
    } catch (error) {
      if (
        this.paused.has(task.id) ||
        this.cancelled.has(task.id) ||
        this.shuttingDown
      ) {
        return;
      }
      const safe = safeFailure(error);
      this.persistence.updateModelDownload(task.id, {
        state: "failed",
        bytesPerSecond: 0,
        error: safe.message,
        completedAt: this.clock.now(),
      });
      this.operations.fail(task.operationId, safe, "failed");
      this.finish(task.id);
    }
  }

  private finish(id: string): void {
    this.tasks.delete(id);
    this.paused.delete(id);
    this.cancelled.delete(id);
    this.completions.get(id)?.resolve();
    this.completions.delete(id);
  }

  private async removeStaging(task: DownloadTask): Promise<void> {
    const finalPath = join(
      task.stagingDirectory,
      task.artifact.filename,
    );
    await Promise.all([
      rm(finalPath, { force: true }),
      rm(`${finalPath}.part`, { force: true }),
    ]);
  }
}
