import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ModelDownloadCreate,
  ModelDownloadDto,
  OperationDto,
  OperationEventDto,
  OperationKind,
} from "@anima/shared";
import type {
  ModelDownloadPatch,
  NewModelDownload,
} from "../db/repository";
import type { OperationProgress } from "../services/operations";
import type { CivitaiMetadataClient } from "./client";
import { DestinationRegistry } from "./destinations";
import {
  NodeFileHasher,
  RemoveInvalidDownloadHandler,
} from "./hash";
import type {
  LoraManagerClient,
  LoraManagerDownloadCompletion,
  LoraManagerDownloadInput,
} from "./lora-manager";
import { CivitaiTokenService } from "./secrets";
import {
  CivitaiModelLibraryService,
  type ModelDownloadOperations,
  type ModelDownloadPersistence,
} from "./service";
import type {
  CivitaiModelInspection,
  ModelDownloadProgress,
  SecretStore,
} from "./types";
import { parseCivitaiModelUrl } from "./url";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 25,
    });
  }
});

class MemorySecrets implements SecretStore {
  private readonly values = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

class MemoryDownloads implements ModelDownloadPersistence {
  readonly rows = new Map<string, ModelDownloadDto>();
  readonly storagePaths = new Map<string, string>();
  private revision = 0;

  createModelDownload(input: NewModelDownload): ModelDownloadDto {
    const createdAt = input.createdAt ?? this.timestamp();
    const row: ModelDownloadDto = {
      id: input.id,
      operationId: input.operationId,
      state: input.state,
      provider: "civitai",
      modelId: input.modelId,
      modelVersionId: input.modelVersionId,
      fileId: input.fileId ?? null,
      modelName: input.modelName,
      versionName: input.versionName,
      filename: input.filename,
      destinationRootId: input.destinationRootId,
      relativeDir: input.relativeDir ?? "",
      expectedSha256: input.expectedSha256 ?? null,
      actualSha256: null,
      bytesCompleted: 0,
      bytesTotal: input.bytesTotal ?? null,
      bytesPerSecond: null,
      triggerWords: input.triggerWords ?? [],
      metadata: input.metadata ?? {},
      error: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };
    this.rows.set(input.id, row);
    return row;
  }

  updateModelDownload(
    id: string,
    patch: ModelDownloadPatch,
  ): ModelDownloadDto | null {
    const current = this.rows.get(id);
    if (!current) return null;
    if (patch.storagePath !== undefined && patch.storagePath !== null) {
      this.storagePaths.set(id, patch.storagePath);
    }
    const updated: ModelDownloadDto = {
      ...current,
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.filename !== undefined
        ? { filename: patch.filename }
        : {}),
      ...(patch.actualSha256 !== undefined
        ? { actualSha256: patch.actualSha256 }
        : {}),
      ...(patch.bytesCompleted !== undefined
        ? { bytesCompleted: patch.bytesCompleted }
        : {}),
      ...(patch.bytesTotal !== undefined
        ? { bytesTotal: patch.bytesTotal }
        : {}),
      ...(patch.bytesPerSecond !== undefined
        ? { bytesPerSecond: patch.bytesPerSecond }
        : {}),
      ...(patch.metadata !== undefined
        ? { metadata: patch.metadata }
        : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.completedAt !== undefined
        ? { completedAt: patch.completedAt }
        : {}),
      updatedAt: this.timestamp(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  findModelDownload(id: string): ModelDownloadDto | null {
    return this.rows.get(id) ?? null;
  }

  listModelDownloads(limit = 50): ModelDownloadDto[] {
    return [...this.rows.values()].slice(0, limit);
  }

  listIncompleteModelDownloads(): ModelDownloadDto[] {
    return [...this.rows.values()].filter((download) =>
      [
        "resolving",
        "queued",
        "downloading",
        "paused",
        "verifying",
        "indexing",
      ].includes(download.state),
    );
  }

  private timestamp(): string {
    this.revision += 1;
    return new Date(1_700_000_000_000 + this.revision).toISOString();
  }
}

class RecordingOperations implements ModelDownloadOperations {
  readonly phases: string[] = [];
  failures = 0;
  private readonly rows = new Map<string, OperationDto>();
  private nextOperation = 0;
  private nextEvent = 0;

  create(
    kind: OperationKind,
    phase: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): OperationDto {
    this.nextOperation += 1;
    const id = `operation_${this.nextOperation}`;
    const row: OperationDto = {
      id,
      kind,
      status: "queued",
      phase,
      message,
      progress: null,
      error: null,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    this.rows.set(id, row);
    this.phases.push(phase);
    return row;
  }

  start(id: string, phase: string, message: string): OperationDto {
    return this.patch(id, {
      status: "running",
      phase,
      message,
      startedAt: new Date().toISOString(),
    });
  }

  report(id: string, progress: OperationProgress): OperationEventDto {
    this.phases.push(progress.phase);
    this.patch(id, {
      phase: progress.phase,
      message: progress.message,
      ...(progress.status ? { status: progress.status } : {}),
      ...(progress.progress !== undefined
        ? { progress: progress.progress }
        : {}),
    });
    this.nextEvent += 1;
    const event: OperationEventDto = {
      id: this.nextEvent,
      operationId: id,
      phase: progress.phase,
      message: progress.message,
      progress: progress.progress ?? null,
      current: progress.current ?? null,
      total: progress.total ?? null,
      bytesCompleted: progress.bytesCompleted ?? null,
      bytesTotal: progress.bytesTotal ?? null,
      bytesPerSecond: progress.bytesPerSecond ?? null,
      createdAt: new Date().toISOString(),
    };
    if (progress.payload !== undefined) event.payload = progress.payload;
    return event;
  }

  complete(
    id: string,
    phase = "completed",
    message = "Operation completed.",
    metadata?: Record<string, unknown>,
  ): OperationDto {
    this.phases.push(phase);
    return this.patch(id, {
      status: "completed",
      phase,
      message,
      progress: 100,
      ...(metadata ? { metadata } : {}),
      completedAt: new Date().toISOString(),
    });
  }

  fail(
    id: string,
    error: unknown,
    phase = "failed",
  ): OperationDto {
    const message =
      error instanceof Error ? error.message : "Operation failed.";
    this.failures += 1;
    this.phases.push(phase);
    return this.patch(id, {
      status: "failed",
      phase,
      message,
      error: message,
      completedAt: new Date().toISOString(),
    });
  }

  cancel(id: string, message = "Operation cancelled."): OperationDto {
    this.phases.push("cancelled");
    return this.patch(id, {
      status: "cancelled",
      phase: "cancelled",
      message,
      completedAt: new Date().toISOString(),
    });
  }

  private patch(
    id: string,
    patch: Partial<OperationDto>,
  ): OperationDto {
    const row = this.rows.get(id);
    if (!row) throw new Error("missing operation");
    const updated = {
      ...row,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }
}

class StaticMetadata implements CivitaiMetadataClient {
  readonly sources: string[] = [];

  constructor(private readonly inspection: CivitaiModelInspection) {}

  async inspect(source: string | ReturnType<typeof parseCivitaiModelUrl>) {
    this.sources.push(
      typeof source === "string" ? source : source.canonicalUrl,
    );
    return this.inspection;
  }
}

class FileWritingManager implements LoraManagerClient {
  readonly controls: string[] = [];

  constructor(
    private readonly bytes: Uint8Array,
    private readonly reportedSha256: string,
    private readonly finalFilename: string | null = null,
  ) {}

  async download(
    input: LoraManagerDownloadInput,
  ): Promise<LoraManagerDownloadCompletion> {
    await mkdir(input.destination.absoluteDirectory, {
      recursive: true,
    });
    const finalPath = join(
      input.destination.absoluteDirectory,
      this.finalFilename ?? input.file.name,
    );
    await Bun.write(finalPath, this.bytes);
    return {
      downloadId: input.downloadId,
      finalPath,
      expectedSha256: input.file.sha256!,
      actualSha256: this.reportedSha256,
    };
  }

  async getProgress(downloadId: string): Promise<ModelDownloadProgress> {
    return {
      downloadId,
      state: "completed",
      percent: 100,
      bytesDownloaded: this.bytes.byteLength,
      totalBytes: this.bytes.byteLength,
      bytesPerSecond: 0,
    };
  }

  async pause(): Promise<void> {
    this.controls.push("pause");
  }

  async resume(): Promise<void> {
    this.controls.push("resume");
  }

  async cancel(): Promise<void> {
    this.controls.push("cancel");
  }
}

class ControlledManager implements LoraManagerClient {
  readonly controls: string[] = [];

  async download(
    input: LoraManagerDownloadInput,
  ): Promise<LoraManagerDownloadCompletion> {
    return new Promise((_, reject) => {
      const abort = () => reject(new Error("request aborted"));
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, {
        once: true,
      });
    });
  }

  async getProgress(downloadId: string): Promise<ModelDownloadProgress> {
    return {
      downloadId,
      state: "downloading",
      percent: 25,
      bytesDownloaded: 25,
      totalBytes: 100,
      bytesPerSecond: 10,
    };
  }

  async pause(): Promise<void> {
    this.controls.push("pause");
  }

  async resume(): Promise<void> {
    this.controls.push("resume");
  }

  async cancel(): Promise<void> {
    this.controls.push("cancel");
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspection(expectedSha256: string): CivitaiModelInspection {
  return {
    reference: parseCivitaiModelUrl(
      "https://civitai.red/models/123?modelVersionId=456",
    ),
    modelId: 123,
    name: "Character LoRA",
    kind: "lora",
    creator: "creator",
    tags: ["character"],
    nsfw: true,
    license: {
      allowNoCredit: false,
      allowCommercialUse: ["Image"],
      allowDerivatives: true,
      allowDifferentLicense: false,
    },
    versions: [
      {
        id: 456,
        name: "v1",
        baseModel: "Illustrious",
        createdAt: null,
        publishedAt: null,
        earlyAccessEndsAt: null,
        triggerWords: ["character_trigger"],
        files: [
          {
            id: 10,
            name: "character.safetensors",
            sizeBytes: 11,
            remoteType: "Model",
            format: "SafeTensor",
            precision: "fp16",
            sizeVariant: "full",
            primary: true,
            sha256: expectedSha256,
            eligible: true,
            blockReason: null,
          },
        ],
      },
    ],
  };
}

async function fixture(
  manager: LoraManagerClient,
  expectedSha256: string,
) {
  const directory = await mkdtemp(
    join(tmpdir(), "anima-civitai-service-"),
  );
  temporaryDirectories.push(directory);
  const metadata = new StaticMetadata(inspection(expectedSha256));
  const persistence = new MemoryDownloads();
  const operations = new RecordingOperations();
  const tokens = new CivitaiTokenService(new MemorySecrets());
  const service = new CivitaiModelLibraryService(
    metadata,
    tokens,
    manager,
    new DestinationRegistry([
      {
        id: "loras",
        label: "LoRA",
        kind: "loras",
        absolutePath: join(directory, "models", "loras"),
      },
    ]),
    new NodeFileHasher(),
    new RemoveInvalidDownloadHandler(),
    persistence,
    operations,
  );
  return {
    directory,
    metadata,
    persistence,
    operations,
    service,
  };
}

const createRequest: ModelDownloadCreate = {
  modelId: 123,
  modelVersionId: 456,
  fileId: 10,
  destinationRootId: "loras",
  relativeDir: "characters",
};

describe("Civitai model library service", () => {
  test("returns a durable task, trusts the terminal POST, verifies the file and records completion", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const manager = new FileWritingManager(
      bytes,
      expected,
      "actual-character.safetensors",
    );
    const context = await fixture(manager, expected);

    expect(await context.service.providerStatus()).toMatchObject({
      provider: "civitai",
      tokenConfigured: false,
      supportedHosts: ["civitai.com", "civitai.red"],
      supportedFormats: [".safetensors"],
      destinations: [
        { id: "loras", label: "LoRA", kind: "loras" },
      ],
    });
    const inspected = await context.service.inspect(
      "https://civitai.red/models/123?modelVersionId=456",
    );
    expect(inspected.host).toBe("civitai.red");
    expect(inspected.versions[0]?.files).toEqual([
      expect.objectContaining({
        id: 10,
        name: "character.safetensors",
        sha256: expected,
      }),
    ]);

    const created = await context.service.create({
      ...createRequest,
      sourceUrl: "https://civitai.red/models/123/character",
    });
    expect(created.state).toBe("queued");
    expect(created.metadata).not.toHaveProperty("absolutePath");
    expect(created.metadata).toMatchObject({
      sourceUrl:
        "https://civitai.red/models/123?modelVersionId=456",
      host: "civitai.red",
      unrestrictedSource: true,
    });
    expect(context.metadata.sources).toEqual([
      "https://civitai.red/models/123?modelVersionId=456",
      "https://civitai.red/models/123?modelVersionId=456",
    ]);
    const completed = await context.service.settled(created.id);

    expect(completed).toMatchObject({
      state: "completed",
      filename: "actual-character.safetensors",
      actualSha256: expected,
      destinationRootId: "loras",
      relativeDir: "characters",
      triggerWords: ["character_trigger"],
      metadata: {
        sourceUrl:
          "https://civitai.red/models/123?modelVersionId=456",
        comfyModelPath:
          "characters/actual-character.safetensors",
      },
      error: null,
    });
    expect(context.service.get(created.id)).toEqual(completed);
    expect(context.service.list()).toContainEqual(completed);
    expect(context.persistence.storagePaths.get(created.id)).toEndWith(
      join("characters", "actual-character.safetensors"),
    );
    expect(JSON.stringify(completed)).not.toContain(
      context.directory,
    );
    expect(context.operations.phases).toContain("verifying");
    expect(context.operations.phases.at(-1)).toBe("completed");
  });

  test("removes a file whose independently computed SHA-256 does not match", async () => {
    const expectedBytes = new TextEncoder().encode("expected bytes");
    const downloadedBytes = new TextEncoder().encode("tampered bytes");
    const expected = sha256(expectedBytes);
    const manager = new FileWritingManager(
      downloadedBytes,
      expected,
    );
    const context = await fixture(manager, expected);
    const created = await context.service.create(createRequest);
    const failed = await context.service.settled(created.id);
    const finalPath = join(
      context.directory,
      "models",
      "loras",
      "characters",
      "character.safetensors",
    );

    expect(failed.state).toBe("failed");
    expect(failed.error).toContain("SHA-256");
    expect(await Bun.file(finalPath).exists()).toBe(false);
    expect(context.operations.phases.at(-1)).toBe("failed");
  });

  test("supports pause, resume, cancel and retry without exposing provider internals", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const manager = new ControlledManager();
    const context = await fixture(manager, expected);
    const created = await context.service.create(createRequest);

    expect((await context.service.pause(created.id)).state).toBe(
      "paused",
    );
    expect((await context.service.resume(created.id)).state).toBe(
      "downloading",
    );
    expect((await context.service.cancel(created.id)).state).toBe(
      "cancelled",
    );
    await context.service.settled(created.id);
    expect(manager.controls).toEqual([
      "pause",
      "resume",
      "cancel",
    ]);

    const retried = await context.service.retry(created.id);
    expect(retried.id).not.toBe(created.id);
    expect(retried.metadata.retryOf).toBe(created.id);
    expect(retried.state).toBe("queued");
    await context.service.cancel(retried.id);
    await context.service.settled(retried.id);
  });

  test("rejects a source URL for a different model before inspection", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const context = await fixture(
      new FileWritingManager(bytes, expected),
      expected,
    );

    await expect(
      context.service.create({
        ...createRequest,
        sourceUrl:
          "https://civitai.red/models/999?modelVersionId=456",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MODEL", status: 400 });
    expect(context.metadata.sources).toEqual([]);
  });

  test("rejects a source URL for a different model version before inspection", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const context = await fixture(
      new FileWritingManager(bytes, expected),
      expected,
    );

    await expect(
      context.service.create({
        ...createRequest,
        sourceUrl:
          "https://civitai.red/models/123?modelVersionId=999",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_VERSION",
      status: 400,
    });
    expect(context.metadata.sources).toEqual([]);
  });

  test("reconciles every persisted non-terminal state as an interrupted retryable failure", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const manager = new ControlledManager();
    const context = await fixture(manager, expected);
    const states = [
      "resolving",
      "queued",
      "downloading",
      "paused",
      "verifying",
      "indexing",
    ] as const;

    for (const state of states) {
      const operation = context.operations.create(
        "model_download",
        state,
        `Persisted ${state} download.`,
      );
      context.persistence.createModelDownload({
        id: `interrupted_${state}`,
        operationId: operation.id,
        state,
        modelId: 123,
        modelVersionId: 456,
        fileId: 10,
        modelName: "Character LoRA",
        versionName: "v1",
        filename: "character.safetensors",
        destinationRootId: "loras",
        relativeDir: "characters",
        expectedSha256: expected,
        triggerWords: ["character_trigger"],
        metadata: {
          sourceUrl:
            "https://civitai.red/models/123?modelVersionId=456",
        },
      });
    }

    const reconciled =
      context.service.reconcileInterruptedDownloads();
    expect(reconciled).toHaveLength(states.length);
    for (const download of reconciled) {
      expect(download).toMatchObject({
        state: "failed",
        bytesPerSecond: 0,
        metadata: { interrupted: true },
      });
      expect(download.error).toContain("restarted");
      expect(download.completedAt).not.toBeNull();
    }
    expect(
      context.service.reconcileInterruptedDownloads(),
    ).toEqual([]);
    expect(
      context.operations.phases.filter(
        (phase) => phase === "interrupted",
      ),
    ).toHaveLength(states.length);

    const retried = await context.service.retry(
      "interrupted_downloading",
    );
    expect(retried).toMatchObject({
      state: "queued",
      metadata: {
        retryOf: "interrupted_downloading",
        host: "civitai.red",
      },
    });
    await context.service.cancel(retried.id);
    await context.service.settled(retried.id);
  });

  test("shutdown aborts and settles active downloads before returning", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const manager = new ControlledManager();
    const context = await fixture(manager, expected);
    const created = await context.service.create(createRequest);

    await context.service.shutdown();
    const failed = context.service.get(created.id);
    expect(failed).toMatchObject({
      state: "failed",
      bytesPerSecond: 0,
    });
    expect(manager.controls).toEqual(["cancel"]);
    const updatedAt = failed.updatedAt;
    await Promise.resolve();
    expect(context.service.get(created.id).updatedAt).toBe(updatedAt);
    await expect(
      context.service.create(createRequest),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("fails the operation when resolved metadata cannot use the requested destination", async () => {
    const bytes = new TextEncoder().encode("model bytes");
    const expected = sha256(bytes);
    const context = await fixture(
      new FileWritingManager(bytes, expected),
      expected,
    );

    await expect(
      context.service.create({
        ...createRequest,
        destinationRootId: "checkpoints",
      }),
    ).rejects.toThrow("destination");
    expect(context.operations.failures).toBe(1);
    expect(context.persistence.rows.size).toBe(0);
  });
});
