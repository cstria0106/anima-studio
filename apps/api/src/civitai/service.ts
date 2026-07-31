import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  CivitaiFileDto,
  CivitaiInspectDto,
  CivitaiVersionDto,
  ModelDownloadCreate,
  ModelDownloadDto,
  ModelDownloadProvider,
  ManagedModelInstallationDto,
} from "@anima/shared";
import type {
  ModelDownloadPatch,
  NewModelDownload,
} from "../db/repository";
import type {
  OperationProgress,
  OperationService,
} from "../services/operations";
import type { CivitaiMetadataClient } from "./client";
import { DestinationRegistry } from "./destinations";
import { CivitaiError, assertCivitai } from "./errors";
import type {
  FileHasher,
  InvalidDownloadHandler,
} from "./hash";
import { sha256Matches } from "./hash";
import type { CivitaiDownloadClient } from "./download";
import type {
  CivitaiFileInspection,
  CivitaiModelInspection,
  CivitaiModelReference,
  CivitaiTokenStatus,
  CivitaiVersionInspection,
  ModelDownloadProgress,
} from "./types";
import { CivitaiTokenService } from "./secrets";
import { parseCivitaiModelUrl } from "./url";

export interface ModelDownloadPersistence {
  createModelDownload(input: NewModelDownload): ModelDownloadDto;
  updateModelDownload(
    id: string,
    patch: ModelDownloadPatch,
  ): ModelDownloadDto | null;
  findModelDownload(id: string): ModelDownloadDto | null;
  listModelDownloads(
    limit?: number,
    provider?: ModelDownloadProvider,
  ): ModelDownloadDto[];
  listModelDownloadsByProviderFile(
    provider: ModelDownloadProvider,
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string,
  ): ModelDownloadDto[];
  listIncompleteModelDownloads(
    provider?: ModelDownloadProvider,
  ): ModelDownloadDto[];
}

export type ModelDownloadOperations = Pick<
  OperationService,
  "create" | "start" | "report" | "complete" | "fail" | "cancel"
>;

export interface CivitaiProviderStatus {
  provider: "civitai";
  available: true;
  tokenConfigured: boolean;
  supportedHosts: ["civitai.com", "civitai.red"];
  supportedFormats: [".safetensors"];
  managedDownloads: true;
  destinations: ReturnType<DestinationRegistry["options"]>;
}

export interface DownloadServiceClock {
  now(): string;
}

const systemClock: DownloadServiceClock = {
  now: () => new Date().toISOString(),
};

interface ActiveDownload {
  providerDownloadId: string;
  operationId: string;
  controller: AbortController;
  completion: Promise<void>;
}

export interface InstalledLoraMetadata {
  name: string;
  value: string;
  triggerWords: string[];
  thumbnailUrl?: string;
}

export interface DownloadedLoraThumbnail {
  bytes: Uint8Array;
  contentType: string;
}

interface CreateContext {
  source: CivitaiModelReference;
  retryOf: string | null;
}

const interruptedDownloadMessage =
  "The API restarted before this model download completed. Retry the download.";

function createSourceReference(
  input: ModelDownloadCreate,
  sourceUrl?: string,
): CivitaiModelReference {
  const source = parseCivitaiModelUrl(
    sourceUrl ??
      `https://civitai.com/models/${input.modelId}?modelVersionId=${input.modelVersionId}`,
  );
  assertCivitai(
    source.modelId === input.modelId,
    "INVALID_MODEL",
    "The Civitai source URL does not match the selected model.",
  );
  assertCivitai(
    source.modelVersionId === null ||
      source.modelVersionId === input.modelVersionId,
    "INVALID_VERSION",
    "The Civitai source URL does not match the selected model version.",
  );

  // A version-less inspected page is valid, but downloads persist the exact
  // selected version while retaining the original .com/.red host provenance.
  if (source.modelVersionId === null) {
    const canonical = new URL(source.canonicalUrl);
    canonical.searchParams.set(
      "modelVersionId",
      String(input.modelVersionId),
    );
    return parseCivitaiModelUrl(canonical.toString());
  }
  return source;
}

function comfyModelPath(
  absoluteRoot: string,
  finalPath: string,
): string {
  const pathFromRoot = relative(
    resolve(absoluteRoot),
    resolve(finalPath),
  );
  assertCivitai(
    pathFromRoot.length > 0 &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot),
    "DOWNLOAD_FAILED",
    "The downloaded model path is outside its managed model root.",
    502,
  );
  return pathFromRoot.split(sep).join("/");
}

export function toCivitaiInspectDto(
  inspection: CivitaiModelInspection,
): CivitaiInspectDto {
  const versions: CivitaiVersionDto[] = inspection.versions.map(
    (version) => ({
      id: version.id,
      name: version.name,
      baseModel: version.baseModel,
      createdAt: version.createdAt,
      earlyAccessEndsAt: version.earlyAccessEndsAt,
      thumbnailUrl: version.thumbnailUrl,
      trainedWords: version.triggerWords,
      files: version.files.flatMap((file): CivitaiFileDto[] => {
        if (!file.eligible || file.id === null) return [];
        return [
          {
            id: file.id,
            name: file.name,
            type: file.remoteType,
            format: file.format,
            size: file.sizeVariant,
            precision: file.precision,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            primary: file.primary,
            installationId: null,
            installationStatus: "not_installed",
            installationProgress: null,
          },
        ];
      }),
    }),
  );
  return {
    provider: "civitai",
    sourceUrl: inspection.reference.canonicalUrl,
    host: inspection.reference.host,
    modelId: inspection.modelId,
    requestedVersionId: inspection.reference.modelVersionId,
    name: inspection.name,
    type: inspection.kind,
    creator: inspection.creator,
    description: null,
    contentRating: inspection.nsfw ? "mature" : "safe",
    license: { ...inspection.license },
    thumbnailUrl: versions[0]?.thumbnailUrl ?? null,
    versions,
  };
}

function selectVersion(
  inspection: CivitaiModelInspection,
  versionId: number,
): CivitaiVersionInspection {
  const version = inspection.versions.find(
    (candidate) => candidate.id === versionId,
  );
  if (!version) {
    throw new CivitaiError(
      "INVALID_VERSION",
      "The selected Civitai model version is not available.",
      400,
    );
  }
  return version;
}

function selectFile(
  version: CivitaiVersionInspection,
  fileId: number | undefined,
): CivitaiFileInspection {
  if (fileId !== undefined) {
    const selected = version.files.find((file) => file.id === fileId);
    if (!selected) {
      throw new CivitaiError(
        "INVALID_FILE",
        "The selected Civitai model file is not available.",
        400,
      );
    }
    if (!selected.eligible) {
      throw new CivitaiError(
        "UNSUPPORTED_FILE",
        "The selected Civitai file is not a verified .safetensors model.",
        400,
      );
    }
    return selected;
  }
  const selected =
    version.files.find((file) => file.eligible && file.primary) ??
    version.files.find((file) => file.eligible);
  if (!selected) {
    throw new CivitaiError(
      "UNSUPPORTED_FILE",
      "This model version has no verified .safetensors file.",
      400,
    );
  }
  return selected;
}

function safeFailure(error: unknown): CivitaiError {
  return error instanceof CivitaiError
    ? error
    : new CivitaiError(
        "DOWNLOAD_FAILED",
        "The model download failed.",
        500,
      );
}

interface InstallationLookup {
  exact: Map<string, ManagedModelInstallationDto>;
  basename: Map<string, ManagedModelInstallationDto | null>;
}

function normalizedModelPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function installationLookup(
  installations: ManagedModelInstallationDto[],
): InstallationLookup {
  const exact = new Map<string, ManagedModelInstallationDto>();
  const byBasename = new Map<string, ManagedModelInstallationDto | null>();
  for (const installation of installations) {
    if (
      installation.provider !== "civitai" ||
      installation.destinationRootId !== "loras"
    ) {
      continue;
    }
    const relativePath = normalizedModelPath(
      [installation.relativeDir, installation.filename]
        .filter(Boolean)
        .join("/"),
    );
    exact.set(relativePath, installation);
    const name = relativePath.split("/").at(-1)!;
    byBasename.set(
      name,
      byBasename.has(name) ? null : installation,
    );
  }
  return { exact, basename: byBasename };
}

function findInstallation(
  installedLora: string,
  lookup: InstallationLookup,
): ManagedModelInstallationDto | null {
  const normalized = normalizedModelPath(installedLora);
  return (
    lookup.exact.get(normalized) ??
    lookup.basename.get(normalized.split("/").at(-1) ?? "") ??
    null
  );
}

/**
 * High-level Hono-facing service. It persists only allowlisted metadata and
 * starts the verified transfer in the background so routes can return a
 * durable task immediately.
 */
export class CivitaiModelLibraryService {
  private readonly active = new Map<string, ActiveDownload>();
  private readonly cancelled = new Set<string>();
  private readonly installationMetadata = new Map<
    string,
    Promise<CivitaiModelInspection>
  >();
  private shuttingDown = false;

  constructor(
    private readonly metadata: CivitaiMetadataClient,
    private readonly tokens: CivitaiTokenService,
    private readonly downloader: CivitaiDownloadClient,
    private readonly destinations: DestinationRegistry,
    private readonly hasher: FileHasher,
    private readonly invalidDownloads: InvalidDownloadHandler,
    private readonly persistence: ModelDownloadPersistence,
    private readonly operations: ModelDownloadOperations,
    private readonly clock: DownloadServiceClock = systemClock,
    private readonly previewFetcher: typeof fetch = fetch,
  ) {}

  async providerStatus(): Promise<CivitaiProviderStatus> {
    const token = await this.tokens.status();
    return {
      provider: "civitai",
      available: true,
      tokenConfigured: token.tokenConfigured,
      supportedHosts: ["civitai.com", "civitai.red"],
      supportedFormats: [".safetensors"],
      managedDownloads: true,
      destinations: this.destinations
        .options()
        .filter((destination) =>
          ["loras", "diffusion_models", "checkpoints"].includes(
            destination.kind,
          ),
        ),
    };
  }

  async setToken(token: string): Promise<CivitaiTokenStatus> {
    const status = await this.tokens.configure(token);
    this.installationMetadata.clear();
    return status;
  }

  async deleteToken(): Promise<CivitaiTokenStatus> {
    const status = await this.tokens.clear();
    this.installationMetadata.clear();
    return status;
  }

  async inspect(url: string): Promise<CivitaiInspectDto> {
    return toCivitaiInspectDto(await this.metadata.inspect(url));
  }

  async getLoraMetadata(
    installedLoras: string[],
    installations: ManagedModelInstallationDto[],
  ): Promise<InstalledLoraMetadata[]> {
    const lookup = installationLookup(installations);
    return Promise.all(
      installedLoras.map(async (value) => {
        const installation = findInstallation(value, lookup);
        if (!installation) {
          return { name: value, value, triggerWords: [] };
        }
        try {
          const inspection = await this.inspectInstallation(installation);
          const version = inspection.versions.find(
            (candidate) =>
              String(candidate.id) === installation.providerVersionId,
          );
          return {
            name: installation.modelName || value,
            value,
            triggerWords: version?.triggerWords ?? [],
            ...(version?.thumbnailUrl
              ? { thumbnailUrl: version.thumbnailUrl }
              : {}),
          };
        } catch {
          return {
            name: installation.modelName || value,
            value,
            triggerWords: [],
          };
        }
      }),
    );
  }

  async downloadLoraThumbnail(
    installedLora: string,
    installations: ManagedModelInstallationDto[],
  ): Promise<DownloadedLoraThumbnail | null> {
    const installation = findInstallation(
      installedLora,
      installationLookup(installations),
    );
    if (!installation) return null;
    const inspection = await this.inspectInstallation(installation);
    const version = inspection.versions.find(
      (candidate) =>
        String(candidate.id) === installation.providerVersionId,
    );
    if (!version?.thumbnailUrl) return null;

    const response = await this.previewFetcher(version.thumbnailUrl, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg",
        "user-agent": "Portable-Anima-Studio/1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (
      !response.ok ||
      !contentType?.startsWith("image/") ||
      (Number.isFinite(declaredBytes) && declaredBytes > 10 * 1_024 * 1_024)
    ) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1_024 * 1_024) {
      return null;
    }
    return { bytes, contentType };
  }

  async create(input: ModelDownloadCreate): Promise<ModelDownloadDto> {
    assertCivitai(
      !this.shuttingDown,
      "DOWNLOAD_FAILED",
      "The model download service is shutting down.",
      409,
    );
    return this.createFromSource(input, {
      source: createSourceReference(input, input.sourceUrl),
      retryOf: null,
    });
  }

  get(id: string): ModelDownloadDto {
    const download = this.persistence.findModelDownload(id);
    if (!download || download.provider !== "civitai") {
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The model download was not found.",
        404,
      );
    }
    return download;
  }

  list(limit = 50): ModelDownloadDto[] {
    return this.persistence.listModelDownloads(
      Math.min(Math.max(limit, 1), 100),
      "civitai",
    );
  }

  /**
   * Mark downloads left in non-terminal states by a previous API process as
   * interrupted. The resulting failed rows retain all selections and remain
   * eligible for retry.
   */
  reconcileInterruptedDownloads(): ModelDownloadDto[] {
    const interruptedAt = this.clock.now();
    const reconciled: ModelDownloadDto[] = [];
    for (const download of this.persistence.listIncompleteModelDownloads(
      "civitai",
    )) {
      // This method normally runs during startup. Avoid disrupting a live
      // transfer if a caller invokes it after this service has accepted work.
      if (this.active.has(download.id)) continue;
      const updated = this.persistence.updateModelDownload(download.id, {
        state: "failed",
        bytesPerSecond: 0,
        metadata: {
          ...download.metadata,
          interrupted: true,
          interruptedAt,
        },
        error: interruptedDownloadMessage,
        completedAt: interruptedAt,
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
        // The durable download row is authoritative for retry. An operation
        // record may already have been reconciled independently at startup.
      }
    }
    return reconciled;
  }

  async progress(id: string): Promise<ModelDownloadProgress> {
    const download = this.get(id);
    const active = this.active.get(id);
    if (!active) {
      return {
        downloadId: id,
        state:
          download.state === "resolving" ||
          download.state === "indexing"
            ? "queued"
            : download.state,
        percent:
          download.state === "completed"
            ? 100
            : download.bytesTotal && download.bytesTotal > 0
              ? Math.min(
                  100,
                  (download.bytesCompleted / download.bytesTotal) * 100,
                )
              : 0,
        bytesDownloaded: download.bytesCompleted,
        totalBytes: download.bytesTotal,
        bytesPerSecond: download.bytesPerSecond,
      };
    }
    return this.downloader.getProgress(active.providerDownloadId);
  }

  async pause(id: string): Promise<ModelDownloadDto> {
    const download = this.get(id);
    assertCivitai(
      download.state === "queued" ||
        download.state === "downloading",
      "DOWNLOAD_FAILED",
      "Only a queued or active download can be paused.",
      409,
    );
    const active = this.active.get(id);
    assertCivitai(
      active,
      "DOWNLOAD_FAILED",
      "The download is not active.",
      409,
    );
    await this.downloader.pause(active.providerDownloadId);
    this.persistence.updateModelDownload(id, {
      state: "paused",
      bytesPerSecond: 0,
    });
    this.operations.report(download.operationId, {
      phase: "paused",
      message: "Model download paused.",
      status: "running",
      bytesCompleted: download.bytesCompleted,
      bytesTotal: download.bytesTotal,
      bytesPerSecond: 0,
    });
    return this.get(id);
  }

  async resume(id: string): Promise<ModelDownloadDto> {
    const download = this.get(id);
    assertCivitai(
      download.state === "paused",
      "DOWNLOAD_FAILED",
      "Only a paused download can be resumed.",
      409,
    );
    const active = this.active.get(id);
    assertCivitai(
      active,
      "DOWNLOAD_FAILED",
      "The download is not active.",
      409,
    );
    await this.downloader.resume(active.providerDownloadId);
    this.persistence.updateModelDownload(id, {
      state: "downloading",
    });
    this.operations.report(download.operationId, {
      phase: "downloading",
      message: "Model download resumed.",
      status: "running",
      bytesCompleted: download.bytesCompleted,
      bytesTotal: download.bytesTotal,
    });
    return this.get(id);
  }

  async cancel(id: string): Promise<ModelDownloadDto> {
    const download = this.get(id);
    assertCivitai(
      !["completed", "failed", "cancelled"].includes(download.state),
      "DOWNLOAD_FAILED",
      "This model download has already finished.",
      409,
    );
    this.cancelled.add(id);
    const active = this.active.get(id);
    if (active) {
      try {
        await this.downloader.cancel(active.providerDownloadId);
      } catch (error) {
        this.cancelled.delete(id);
        throw error;
      }
      active.controller.abort();
    }
    this.persistence.updateModelDownload(id, {
      state: "cancelled",
      bytesPerSecond: 0,
      completedAt: this.clock.now(),
      error: null,
    });
    this.operations.cancel(download.operationId, "Model download cancelled.");
    return this.get(id);
  }

  async retry(id: string): Promise<ModelDownloadDto> {
    const previous = this.get(id);
    assertCivitai(
      previous.state === "failed" ||
        previous.state === "cancelled",
      "DOWNLOAD_FAILED",
      "Only a failed or cancelled model download can be retried.",
      409,
    );
    assertCivitai(
      previous.modelId !== null &&
        previous.modelVersionId !== null &&
        previous.fileId !== null &&
        ["loras", "diffusion_models", "checkpoints"].includes(
          previous.destinationRootId,
        ),
      "INVALID_FILE",
      "The previous download did not retain its Civitai selection.",
      409,
    );
    const sourceUrl =
      typeof previous.metadata.sourceUrl === "string"
        ? previous.metadata.sourceUrl
        : `https://civitai.com/models/${previous.modelId}?modelVersionId=${previous.modelVersionId}`;
    const input: ModelDownloadCreate = {
      modelId: previous.modelId,
      modelVersionId: previous.modelVersionId,
      fileId: previous.fileId,
      sourceUrl,
      destinationRootId:
        previous.destinationRootId as ModelDownloadCreate["destinationRootId"],
      relativeDir: previous.relativeDir,
    };
    return this.createFromSource(input, {
      source: createSourceReference(input, sourceUrl),
      retryOf: previous.id,
    });
  }

  async settled(id: string): Promise<ModelDownloadDto> {
    await this.active.get(id)?.completion;
    return this.get(id);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const active = [...this.active.values()];
    for (const download of active) {
      download.controller.abort();
    }
    await Promise.allSettled(
      active.map((download) => download.completion),
    );
  }

  private async createFromSource(
    input: ModelDownloadCreate,
    context: CreateContext,
  ): Promise<ModelDownloadDto> {
    const operation = this.operations.create(
      "model_download",
      "resolving",
      "Resolving Civitai model.",
      {
        provider: "civitai",
        modelId: input.modelId,
        modelVersionId: input.modelVersionId,
        destinationRootId: input.destinationRootId,
        ...(context.retryOf ? { retryOf: context.retryOf } : {}),
      },
    );

    let resolved: {
      inspection: CivitaiModelInspection;
      version: CivitaiVersionInspection;
      file: CivitaiFileInspection & {
        id: number;
        sha256: string;
      };
      destination: ReturnType<DestinationRegistry["resolve"]>;
    };
    try {
      const inspection = await this.metadata.inspect(context.source);
      assertCivitai(
        inspection.modelId === input.modelId,
        "INVALID_MODEL",
        "Civitai returned metadata for a different model.",
        502,
      );
      const version = selectVersion(
        inspection,
        input.modelVersionId,
      );
      const file = selectFile(version, input.fileId);
      if (file.id === null || file.sha256 === null) {
        throw new CivitaiError(
          "UNSUPPORTED_FILE",
          "The selected Civitai file cannot be verified.",
          400,
        );
      }
      const verifiedFile = {
        ...file,
        id: file.id,
        sha256: file.sha256,
      };
      const destination = this.destinations.resolve(
        input.destinationRootId,
        inspection.kind,
        input.relativeDir,
      );
      resolved = {
        inspection,
        version,
        file: verifiedFile,
        destination,
      };
    } catch (error) {
      const safe = safeFailure(error);
      this.operations.fail(operation.id, safe, "resolving");
      throw safe;
    }
    const {
      inspection,
      version,
      file: verifiedFile,
      destination,
    } = resolved;

    const id = crypto.randomUUID();
    const metadata: Record<string, unknown> = {
      sourceUrl: context.source.canonicalUrl,
      host: context.source.host,
      modelKind: inspection.kind,
      baseModel: version.baseModel,
      unrestrictedSource: context.source.unrestrictedSource,
      license: { ...inspection.license },
      ...(context.retryOf ? { retryOf: context.retryOf } : {}),
    };
    const created = this.persistence.createModelDownload({
      id,
      operationId: operation.id,
      state: "queued",
      providerDownloadId: id,
      modelId: inspection.modelId,
      modelVersionId: version.id,
      fileId: verifiedFile.id,
      modelName: inspection.name,
      versionName: version.name,
      filename: verifiedFile.name,
      destinationRootId: input.destinationRootId,
      relativeDir: destination.relativeDirectory,
      expectedSha256: verifiedFile.sha256,
      bytesTotal: verifiedFile.sizeBytes,
      triggerWords: version.triggerWords,
      metadata,
      createdAt: this.clock.now(),
    });
    this.operations.start(
      operation.id,
      "queued",
      "Model download queued.",
    );

    const controller = new AbortController();
    const completion = this.execute({
      id,
      operationId: operation.id,
      inspection,
      version,
      file: verifiedFile,
      destination,
      controller,
      metadata,
    });
    this.active.set(id, {
      providerDownloadId: id,
      operationId: operation.id,
      controller,
      completion,
    });
    void completion.finally(() => {
      this.active.delete(id);
      this.cancelled.delete(id);
    });
    return created;
  }

  private async execute(input: {
    id: string;
    operationId: string;
    inspection: CivitaiModelInspection;
    version: CivitaiVersionInspection;
    file: CivitaiFileInspection & { id: number; sha256: string };
    destination: ReturnType<DestinationRegistry["resolve"]>;
    controller: AbortController;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      this.persistence.updateModelDownload(input.id, {
        state: "downloading",
      });
      this.operations.report(input.operationId, {
        phase: "downloading",
        message: "Downloading model from Civitai.",
        status: "running",
        progress: 0,
        bytesCompleted: 0,
        bytesTotal: input.file.sizeBytes,
      });
      const result = await this.downloader.download({
        downloadId: input.id,
        modelId: input.inspection.modelId,
        versionId: input.version.id,
        modelKind: input.inspection.kind,
        file: input.file,
        destination: input.destination,
        signal: input.controller.signal,
        onProgress: (progress) =>
          this.recordProgress(input.id, input.operationId, progress),
      });

      const finalPath = await this.destinations.verifyFinalFile(
        input.destination,
        result.finalPath,
      );
      const finalFilename = basename(finalPath);
      const finalComfyModelPath = comfyModelPath(
        input.destination.absoluteRoot,
        finalPath,
      );
      if (this.cancelled.has(input.id)) {
        await this.invalidDownloads.reject(finalPath, input.id);
        return;
      }

      this.persistence.updateModelDownload(input.id, {
        state: "verifying",
        bytesPerSecond: 0,
      });
      this.operations.report(input.operationId, {
        phase: "verifying",
        message: "Verifying model SHA-256.",
        status: "running",
        progress: 99,
        bytesCompleted: input.file.sizeBytes,
        bytesTotal: input.file.sizeBytes,
        bytesPerSecond: 0,
      });
      const computedSha256 = await this.hasher.sha256(finalPath);
      this.persistence.updateModelDownload(input.id, {
        actualSha256: computedSha256,
      });
      if (
        (result.expectedSha256 !== null &&
          !sha256Matches(
            input.file.sha256,
            result.expectedSha256,
          )) ||
        (result.actualSha256 !== null &&
          !sha256Matches(
            input.file.sha256,
            result.actualSha256,
          )) ||
        !sha256Matches(input.file.sha256, computedSha256)
      ) {
        await this.invalidDownloads.reject(finalPath, input.id);
        throw new CivitaiError(
          "HASH_MISMATCH",
          "The downloaded model failed SHA-256 verification.",
          502,
        );
      }

      this.persistence.updateModelDownload(input.id, {
        state: "indexing",
        bytesCompleted: input.file.sizeBytes ?? 0,
        bytesTotal: input.file.sizeBytes,
        bytesPerSecond: 0,
      });
      this.operations.report(input.operationId, {
        phase: "indexing",
        message: "Indexing the downloaded model.",
        status: "running",
        progress: 99,
        bytesCompleted: input.file.sizeBytes,
        bytesTotal: input.file.sizeBytes,
        bytesPerSecond: 0,
      });

      const completedAt = this.clock.now();
      const completedMetadata = {
        ...input.metadata,
        comfyModelPath: finalComfyModelPath,
      };
      this.persistence.updateModelDownload(input.id, {
        state: "completed",
        filename: finalFilename,
        actualSha256: computedSha256,
        bytesCompleted: input.file.sizeBytes ?? 0,
        bytesTotal: input.file.sizeBytes,
        bytesPerSecond: 0,
        storagePath: finalPath,
        metadata: completedMetadata,
        error: null,
        completedAt,
      });
      this.operations.complete(
        input.operationId,
        "completed",
        "Model download completed.",
        {
          ...completedMetadata,
          filename: finalFilename,
          sha256: computedSha256,
        },
      );
    } catch (error) {
      if (this.cancelled.has(input.id)) return;
      const safe = safeFailure(error);
      this.persistence.updateModelDownload(input.id, {
        state: "failed",
        bytesPerSecond: 0,
        error: safe.message,
        completedAt: this.clock.now(),
      });
      this.operations.fail(input.operationId, safe, "failed");
    }
  }

  private recordProgress(
    id: string,
    operationId: string,
    progress: ModelDownloadProgress,
  ): void {
    const state =
      progress.state === "paused"
        ? "paused"
        : progress.state === "queued"
          ? "queued"
          : "downloading";
    this.persistence.updateModelDownload(id, {
      state,
      bytesCompleted: progress.bytesDownloaded ?? 0,
      bytesTotal: progress.totalBytes,
      bytesPerSecond: state === "paused" ? 0 : progress.bytesPerSecond,
    });
    const report: OperationProgress = {
      phase: state,
      message:
        state === "paused"
          ? "Model download paused."
          : state === "queued"
            ? "Model download queued."
            : "Downloading model from Civitai.",
      status: "running",
      progress: progress.percent,
      bytesCompleted: progress.bytesDownloaded,
      bytesTotal: progress.totalBytes,
      bytesPerSecond: state === "paused" ? 0 : progress.bytesPerSecond,
    };
    this.operations.report(operationId, report);
  }

  private inspectInstallation(
    installation: ManagedModelInstallationDto,
  ): Promise<CivitaiModelInspection> {
    const modelId = Number(installation.providerModelId);
    const versionId = Number(installation.providerVersionId);
    if (
      !Number.isSafeInteger(modelId) ||
      modelId <= 0 ||
      !Number.isSafeInteger(versionId) ||
      versionId <= 0
    ) {
      return Promise.reject(
        new CivitaiError(
          "INVALID_MODEL",
          "The installed Civitai model identity is invalid.",
          500,
        ),
      );
    }
    const key = `${modelId}:${versionId}`;
    const existing = this.installationMetadata.get(key);
    if (existing) return existing;
    const inspection = this.metadata.inspect(
      `https://civitai.red/models/${modelId}?modelVersionId=${versionId}`,
    );
    this.installationMetadata.set(key, inspection);
    void inspection.catch(() => {
      if (this.installationMetadata.get(key) === inspection) {
        this.installationMetadata.delete(key);
      }
    });
    return inspection;
  }
}
