import type {
  AssetDto,
  GenerationConfig,
  JobDto,
  JobEventDto,
  JobKind,
  JobPhase,
  JobPreviewDto,
  JobStatus,
  ManagedModelInstallationDto,
  ModelDownloadDto,
  ModelDownloadProvider,
  ModelDownloadState,
  OperationDto,
  OperationEventDto,
  OperationKind,
  OperationStatus,
  OutputDto,
  TagSuggestion,
} from "@anima/shared";
import { generationConfigSchema } from "@anima/shared";
import {
  escapeDanbooruTagForPrompt,
  normalizeDanbooruTag,
  type OfflineTag,
  type OfflineTagCooccurrence,
} from "@anima/tag-data";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { DatabaseContext } from "./database";
import {
  assets,
  jobAssets,
  jobEvents,
  jobs,
  managedModelInstallations,
  modelDownloads,
  outputs,
  runtimeSessions,
  settings,
  systemOperationEvents,
  systemOperations,
  tags,
  type AssetRow,
  type JobEventRow,
  type JobRow,
  type ManagedModelInstallationRow,
  type ModelDownloadRow,
  type OutputRow,
  type RuntimeSessionRow,
  type SystemOperationEventRow,
  type SystemOperationRow,
} from "./schema";

export interface TagIndexMetadata {
  fingerprint: string;
  source: "danbooru" | "fallback";
  tagCount: number;
  cooccurrenceCount: number;
  minimumCooccurrenceCount: number | null;
  importedAt: string;
}

export interface TagIndexStats {
  tagCount: number;
  cooccurrenceCount: number;
  skippedCooccurrences: number;
}

function tagLexicalTier(tag: string, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const normalizedTag = normalizeDanbooruTag(tag).toLowerCase();
  if (normalizedTag === normalizedQuery) return 0;
  if (normalizedTag.startsWith(normalizedQuery)) return 1;
  if (normalizedTag.includes(normalizedQuery)) return 2;
  return 3;
}

function compareTagNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const terminalStatuses = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function toIso(value: string | null): string | null {
  if (!value) return null;
  if (value.includes("T")) return value;
  return `${value.replace(" ", "T")}Z`;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function assetToDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    sha256: row.sha256,
    name: row.originalName,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    url: `/api/assets/${encodeURIComponent(row.id)}`,
    createdAt: toIso(row.createdAt) ?? row.createdAt,
  };
}

export function outputToDto(row: OutputRow): OutputDto {
  return {
    id: row.id,
    kind: row.kind === "upscale" ? "upscale" : "base",
    filename: row.filename,
    mimeType: row.mimeType,
    url: `/api/outputs/${encodeURIComponent(row.id)}`,
    width: row.width,
    height: row.height,
  };
}

export function eventToDto(row: JobEventRow): JobEventDto {
  const payload = parseJson<Record<string, unknown>>(row.payloadJson, {});
  const rawPreview =
    payload.preview && typeof payload.preview === "object"
      ? (payload.preview as Record<string, unknown>)
      : null;
  const preview: JobPreviewDto | null =
    rawPreview &&
    typeof rawPreview.url === "string" &&
    typeof rawPreview.mimeType === "string" &&
    typeof rawPreview.revision === "number" &&
    typeof rawPreview.updatedAt === "string"
      ? {
          url: rawPreview.url,
          mimeType: rawPreview.mimeType,
          revision: rawPreview.revision,
          step:
            typeof rawPreview.step === "number" ? rawPreview.step : null,
          total:
            typeof rawPreview.total === "number" ? rawPreview.total : null,
          updatedAt: rawPreview.updatedAt,
        }
      : null;
  const dto: JobEventDto = {
    id: row.id,
    jobId: row.jobId,
    phase: row.phase as JobPhase,
    message: row.message,
    progress: row.progress,
    current: row.current,
    total: row.total,
    createdAt: toIso(row.createdAt) ?? row.createdAt,
  };
  if (preview) dto.preview = preview;
  return dto;
}

export function operationEventToDto(
  row: SystemOperationEventRow,
): OperationEventDto {
  const dto: OperationEventDto = {
    id: row.id,
    operationId: row.operationId,
    phase: row.phase,
    message: row.message,
    progress: row.progress,
    current: row.current,
    total: row.total,
    bytesCompleted: row.bytesCompleted,
    bytesTotal: row.bytesTotal,
    bytesPerSecond: row.bytesPerSecond,
    createdAt: toIso(row.createdAt) ?? row.createdAt,
  };
  if (row.payloadJson) {
    dto.payload = parseJson<unknown>(row.payloadJson, null);
  }
  return dto;
}

export function modelDownloadToDto(
  row: ModelDownloadRow,
): ModelDownloadDto {
  const provider = row.provider as ModelDownloadProvider;
  return {
    id: row.id,
    operationId: row.operationId,
    state: row.state as ModelDownloadState,
    provider,
    providerModelId: row.providerModelId,
    providerVersionId: row.providerVersionId,
    providerFileId: row.providerFileId,
    modelId: provider === "civitai" ? row.modelId : null,
    modelVersionId: provider === "civitai" ? row.modelVersionId : null,
    fileId: row.fileId,
    modelName: row.modelName,
    versionName: row.versionName,
    filename: row.filename,
    destinationRootId:
      row.destinationRootId as ModelDownloadDto["destinationRootId"],
    relativeDir: row.relativeDir,
    expectedSha256: row.expectedSha256,
    actualSha256: row.actualSha256,
    bytesCompleted: row.bytesCompleted,
    bytesTotal: row.bytesTotal,
    bytesPerSecond: row.bytesPerSecond,
    triggerWords: parseJson<string[]>(row.triggerWordsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    error: row.error,
    createdAt: toIso(row.createdAt) ?? row.createdAt,
    updatedAt: toIso(row.updatedAt) ?? row.updatedAt,
    completedAt: toIso(row.completedAt),
  };
}

export function managedModelInstallationToDto(
  row: ManagedModelInstallationRow,
): ManagedModelInstallationDto {
  return {
    id: row.id,
    provider: row.provider as ManagedModelInstallationDto["provider"],
    sourceUrl: row.sourceUrl,
    providerModelId: row.providerModelId,
    providerVersionId: row.providerVersionId,
    providerFileId: row.providerFileId,
    modelName: row.modelName,
    versionName: row.versionName,
    filename: row.filename,
    destinationRootId:
      row.destinationRootId as ManagedModelInstallationDto["destinationRootId"],
    relativeDir: row.relativeDir,
    sha256: row.sha256,
    storagePath: row.storagePath,
    installedAt: toIso(row.installedAt) ?? row.installedAt,
    updatedAt: toIso(row.updatedAt) ?? row.updatedAt,
  };
}

export interface NewAsset {
  id: string;
  sha256: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  storagePath: string;
  createdAt: string;
}

export interface NewJob {
  id: string;
  kind?: JobKind;
  parentJobId?: string | null;
  sourceOutputId?: string | null;
  clientId: string;
  config: GenerationConfig;
  actualSeed: number;
  assetIds: string[];
  createdAt: string;
}

export interface JobUpdate {
  status?: JobStatus;
  phase?: JobPhase;
  comfyPromptId?: string | null;
  queueNumber?: number | null;
  workflow?: Record<string, unknown> | null;
  nodePhases?: Record<string, JobPhase> | null;
  nodeLabels?: Record<string, string> | null;
  outputKinds?: Record<string, "base" | "upscale"> | null;
  autoTagsNodeId?: string | null;
  autoTags?: string;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface NewEvent {
  jobId: string;
  phase: JobPhase;
  message: string;
  progress?: number | null;
  current?: number | null;
  total?: number | null;
  payload?: unknown;
  createdAt?: string;
}

export interface NewOutput {
  id: string;
  jobId: string;
  kind: "base" | "upscale";
  nodeId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  storagePath: string;
  comfyFilename: string;
  comfySubfolder: string;
  comfyType: string;
  createdAt: string;
}

export interface JobListQuery {
  status?: JobStatus;
  model?: string;
  query?: string;
  before?: string;
  limit?: number;
}

export interface NewSystemOperation {
  id: string;
  kind: OperationKind;
  status?: OperationStatus;
  phase: string;
  message?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface SystemOperationPatch {
  status?: OperationStatus;
  phase?: string;
  message?: string;
  progress?: number | null;
  metadata?: Record<string, unknown>;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface NewSystemOperationEvent {
  operationId: string;
  phase: string;
  message: string;
  progress?: number | null;
  current?: number | null;
  total?: number | null;
  bytesCompleted?: number | null;
  bytesTotal?: number | null;
  bytesPerSecond?: number | null;
  payload?: unknown;
  createdAt?: string;
}

export interface NewRuntimeSession {
  id: string;
  bundleId: string;
  pid: number;
  executablePath: string;
  command: string[];
  port: number;
  logPath: string;
  status: string;
  startedAt?: string;
}

export interface RuntimeSessionPatch {
  status?: string;
  stoppedAt?: string | null;
  exitCode?: number | null;
}

export interface NewModelDownload {
  id: string;
  operationId: string;
  state: ModelDownloadState;
  provider?: ModelDownloadProvider;
  providerDownloadId?: string | null;
  providerModelId?: string;
  providerVersionId?: string;
  providerFileId?: string | null;
  modelId?: number;
  modelVersionId?: number;
  fileId?: number | null;
  modelName: string;
  versionName: string;
  filename: string;
  destinationRootId: ModelDownloadDto["destinationRootId"];
  relativeDir?: string;
  expectedSha256?: string | null;
  bytesTotal?: number | null;
  triggerWords?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface ModelDownloadPatch {
  state?: ModelDownloadState;
  providerDownloadId?: string | null;
  filename?: string;
  actualSha256?: string | null;
  bytesCompleted?: number;
  bytesTotal?: number | null;
  bytesPerSecond?: number | null;
  metadata?: Record<string, unknown>;
  storagePath?: string | null;
  error?: string | null;
  completedAt?: string | null;
}

export interface NewManagedModelInstallation {
  id: string;
  provider: ManagedModelInstallationDto["provider"];
  sourceUrl?: string | null;
  providerModelId: string;
  providerVersionId: string;
  providerFileId: string | null;
  modelName: string;
  versionName: string;
  filename: string;
  destinationRootId: ManagedModelInstallationDto["destinationRootId"];
  relativeDir?: string;
  sha256: string;
  storagePath: string;
  installedAt?: string;
}

export interface RepositoryDependency {
  kind: "job";
  id: string;
  label: string;
}

export class StudioRepository {
  constructor(readonly database: DatabaseContext) {}

  get db() {
    return this.database.db;
  }

  getSetting<T>(key: string): T | null {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row ? parseJson<T>(row.valueJson, null as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db
      .insert(settings)
      .values({ key, valueJson: JSON.stringify(value), updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { valueJson: JSON.stringify(value), updatedAt: now },
      })
      .run();
  }

  createSystemOperation(input: NewSystemOperation): OperationDto {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .insert(systemOperations)
      .values({
        id: input.id,
        kind: input.kind,
        status: input.status ?? "queued",
        phase: input.phase,
        message: input.message ?? "",
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    return this.findSystemOperation(input.id)!;
  }

  updateSystemOperation(
    id: string,
    patch: SystemOperationPatch,
  ): OperationDto | null {
    const set: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.phase !== undefined) set.phase = patch.phase;
    if (patch.message !== undefined) set.message = patch.message;
    if (patch.progress !== undefined) set.progress = patch.progress;
    if (patch.metadata !== undefined) {
      set.metadataJson = JSON.stringify(patch.metadata);
    }
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    this.db
      .update(systemOperations)
      .set(set)
      .where(eq(systemOperations.id, id))
      .run();
    return this.findSystemOperation(id);
  }

  addSystemOperationEvent(
    input: NewSystemOperationEvent,
  ): OperationEventDto {
    const row = this.db
      .insert(systemOperationEvents)
      .values({
        operationId: input.operationId,
        phase: input.phase,
        message: input.message,
        progress: input.progress ?? null,
        current: input.current ?? null,
        total: input.total ?? null,
        bytesCompleted: input.bytesCompleted ?? null,
        bytesTotal: input.bytesTotal ?? null,
        bytesPerSecond: input.bytesPerSecond ?? null,
        payloadJson:
          input.payload === undefined ? null : JSON.stringify(input.payload),
        createdAt: input.createdAt ?? new Date().toISOString(),
      })
      .returning()
      .get();
    return operationEventToDto(row);
  }

  listSystemOperationEvents(
    operationId: string,
    afterId = 0,
    limit = 1_000,
  ): OperationEventDto[] {
    return this.db
      .select()
      .from(systemOperationEvents)
      .where(
        and(
          eq(systemOperationEvents.operationId, operationId),
          sql`${systemOperationEvents.id} > ${afterId}`,
        ),
      )
      .orderBy(asc(systemOperationEvents.id))
      .limit(Math.min(Math.max(limit, 1), 10_000))
      .all()
      .map(operationEventToDto);
  }

  latestSystemOperationEvent(
    operationId: string,
  ): OperationEventDto | null {
    const row =
      this.db
        .select()
        .from(systemOperationEvents)
        .where(eq(systemOperationEvents.operationId, operationId))
        .orderBy(desc(systemOperationEvents.id))
        .limit(1)
        .get() ?? null;
    return row ? operationEventToDto(row) : null;
  }

  private systemOperationToDto(row: SystemOperationRow): OperationDto {
    const dto: OperationDto = {
      id: row.id,
      kind: row.kind as OperationKind,
      status: row.status as OperationStatus,
      phase: row.phase,
      message: row.message,
      progress: row.progress,
      error: row.error,
      metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
      createdAt: toIso(row.createdAt) ?? row.createdAt,
      updatedAt: toIso(row.updatedAt) ?? row.updatedAt,
      startedAt: toIso(row.startedAt),
      completedAt: toIso(row.completedAt),
    };
    const event = this.latestSystemOperationEvent(row.id);
    if (event) dto.latestEvent = event;
    return dto;
  }

  findSystemOperation(id: string): OperationDto | null {
    const row =
      this.db
        .select()
        .from(systemOperations)
        .where(eq(systemOperations.id, id))
        .get() ?? null;
    return row ? this.systemOperationToDto(row) : null;
  }

  listSystemOperations(limit = 50): OperationDto[] {
    return this.db
      .select()
      .from(systemOperations)
      .orderBy(desc(systemOperations.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
      .all()
      .map((row) => this.systemOperationToDto(row));
  }

  listActiveSystemOperations(): OperationDto[] {
    return this.db
      .select()
      .from(systemOperations)
      .where(inArray(systemOperations.status, ["queued", "running"]))
      .orderBy(asc(systemOperations.createdAt))
      .all()
      .map((row) => this.systemOperationToDto(row));
  }

  createRuntimeSession(input: NewRuntimeSession): RuntimeSessionRow {
    this.db
      .insert(runtimeSessions)
      .values({
        id: input.id,
        bundleId: input.bundleId,
        pid: input.pid,
        executablePath: input.executablePath,
        commandJson: JSON.stringify(input.command),
        port: input.port,
        logPath: input.logPath,
        status: input.status,
        startedAt: input.startedAt ?? new Date().toISOString(),
      })
      .run();
    return this.findRuntimeSession(input.id)!;
  }

  updateRuntimeSession(
    id: string,
    patch: RuntimeSessionPatch,
  ): RuntimeSessionRow | null {
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.stoppedAt !== undefined) set.stoppedAt = patch.stoppedAt;
    if (patch.exitCode !== undefined) set.exitCode = patch.exitCode;
    if (Object.keys(set).length > 0) {
      this.db
        .update(runtimeSessions)
        .set(set)
        .where(eq(runtimeSessions.id, id))
        .run();
    }
    return this.findRuntimeSession(id);
  }

  findRuntimeSession(id: string): RuntimeSessionRow | null {
    return (
      this.db
        .select()
        .from(runtimeSessions)
        .where(eq(runtimeSessions.id, id))
        .get() ?? null
    );
  }

  latestRuntimeSession(): RuntimeSessionRow | null {
    return (
      this.db
        .select()
        .from(runtimeSessions)
        .orderBy(desc(runtimeSessions.startedAt))
        .limit(1)
        .get() ?? null
    );
  }

  createModelDownload(input: NewModelDownload): ModelDownloadDto {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .insert(modelDownloads)
      .values({
        id: input.id,
        operationId: input.operationId,
        state: input.state,
        provider: input.provider ?? "civitai",
        providerDownloadId: input.providerDownloadId ?? null,
        providerModelId:
          input.providerModelId ?? String(input.modelId ?? ""),
        providerVersionId:
          input.providerVersionId ?? String(input.modelVersionId ?? ""),
        providerFileId:
          input.providerFileId ??
          (input.fileId === undefined || input.fileId === null
            ? null
            : String(input.fileId)),
        modelId: input.modelId ?? null,
        modelVersionId: input.modelVersionId ?? null,
        fileId: input.fileId ?? null,
        modelName: input.modelName,
        versionName: input.versionName,
        filename: input.filename,
        destinationRootId: input.destinationRootId,
        relativeDir: input.relativeDir ?? "",
        expectedSha256: input.expectedSha256 ?? null,
        bytesTotal: input.bytesTotal ?? null,
        triggerWordsJson: JSON.stringify(input.triggerWords ?? []),
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    return this.findModelDownload(input.id)!;
  }

  updateModelDownload(
    id: string,
    patch: ModelDownloadPatch,
  ): ModelDownloadDto | null {
    const set: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.state !== undefined) set.state = patch.state;
    if (patch.providerDownloadId !== undefined) {
      set.providerDownloadId = patch.providerDownloadId;
    }
    if (patch.filename !== undefined) set.filename = patch.filename;
    if (patch.actualSha256 !== undefined) {
      set.actualSha256 = patch.actualSha256;
    }
    if (patch.bytesCompleted !== undefined) {
      set.bytesCompleted = patch.bytesCompleted;
    }
    if (patch.bytesTotal !== undefined) set.bytesTotal = patch.bytesTotal;
    if (patch.bytesPerSecond !== undefined) {
      set.bytesPerSecond = patch.bytesPerSecond;
    }
    if (patch.metadata !== undefined) {
      set.metadataJson = JSON.stringify(patch.metadata);
    }
    if (patch.storagePath !== undefined) set.storagePath = patch.storagePath;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    this.db
      .update(modelDownloads)
      .set(set)
      .where(eq(modelDownloads.id, id))
      .run();
    return this.findModelDownload(id);
  }

  findModelDownload(id: string): ModelDownloadDto | null {
    const row =
      this.db
        .select()
        .from(modelDownloads)
        .where(eq(modelDownloads.id, id))
        .get() ?? null;
    return row ? modelDownloadToDto(row) : null;
  }

  findModelDownloadRow(id: string): ModelDownloadRow | null {
    return (
      this.db
        .select()
        .from(modelDownloads)
        .where(eq(modelDownloads.id, id))
        .get() ?? null
    );
  }

  listModelDownloads(
    limit = 50,
    provider?: ModelDownloadProvider,
  ): ModelDownloadDto[] {
    const query = this.db
      .select()
      .from(modelDownloads)
      .$dynamic();
    return query
      .where(provider ? eq(modelDownloads.provider, provider) : undefined)
      .orderBy(desc(modelDownloads.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
      .all()
      .map(modelDownloadToDto);
  }

  listModelDownloadsByProviderFile(
    provider: ModelDownloadProvider,
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string,
  ): ModelDownloadDto[] {
    return this.db
      .select()
      .from(modelDownloads)
      .where(
        and(
          eq(modelDownloads.provider, provider),
          eq(modelDownloads.providerModelId, providerModelId),
          eq(modelDownloads.providerVersionId, providerVersionId),
          eq(modelDownloads.providerFileId, providerFileId),
        ),
      )
      .orderBy(desc(modelDownloads.createdAt))
      .all()
      .map(modelDownloadToDto);
  }

  listIncompleteModelDownloads(
    provider?: ModelDownloadProvider,
  ): ModelDownloadDto[] {
    const stateClause = inArray(modelDownloads.state, [
      "resolving",
      "queued",
      "downloading",
      "paused",
      "verifying",
      "indexing",
    ] satisfies ModelDownloadState[]);
    return this.db
      .select()
      .from(modelDownloads)
      .where(
        provider
          ? and(eq(modelDownloads.provider, provider), stateClause)
          : stateClause,
      )
      .orderBy(asc(modelDownloads.createdAt))
      .all()
      .map(modelDownloadToDto);
  }

  upsertManagedModelInstallation(
    input: NewManagedModelInstallation,
  ): ManagedModelInstallationDto {
    return this.upsertManagedModelInstallations([input])[0]!;
  }

  upsertManagedModelInstallations(
    inputs: readonly NewManagedModelInstallation[],
  ): ManagedModelInstallationDto[] {
    if (inputs.length === 0) return [];
    const normalized = inputs.map((input) => {
      const sha256 = input.sha256.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error("Managed model installation SHA-256 is invalid.");
      }
      const installedAt = input.installedAt ?? new Date().toISOString();
      return {
        ...input,
        relativeDir: input.relativeDir ?? "",
        sha256,
        installedAt,
      };
    });
    const ids = new Set<string>();
    const identities = new Set<string>();
    const storagePaths = new Set<string>();
    for (const input of normalized) {
      const identity = JSON.stringify([
        input.provider,
        input.providerModelId,
        input.providerVersionId,
        input.providerFileId,
      ]);
      if (ids.has(input.id)) {
        throw new Error("Managed model installation IDs must be unique.");
      }
      if (identities.has(identity)) {
        throw new Error(
          "Managed model installation identities must be unique.",
        );
      }
      if (storagePaths.has(input.storagePath)) {
        throw new Error(
          "Managed model installation storage paths must be unique.",
        );
      }
      ids.add(input.id);
      identities.add(identity);
      storagePaths.add(input.storagePath);
    }
    return this.database.sqlite.transaction(() => {
      for (const input of normalized) {
        const pathOwner =
          this.db
            .select({
              id: managedModelInstallations.id,
              provider: managedModelInstallations.provider,
              providerModelId: managedModelInstallations.providerModelId,
              providerVersionId:
                managedModelInstallations.providerVersionId,
              providerFileId: managedModelInstallations.providerFileId,
            })
            .from(managedModelInstallations)
            .where(
              eq(
                managedModelInstallations.storagePath,
                input.storagePath,
              ),
            )
            .get() ?? null;
        if (
          pathOwner &&
          (pathOwner.provider !== input.provider ||
            pathOwner.providerModelId !== input.providerModelId ||
            pathOwner.providerVersionId !== input.providerVersionId ||
            pathOwner.providerFileId !== input.providerFileId)
        ) {
          this.db
            .delete(managedModelInstallations)
            .where(eq(managedModelInstallations.id, pathOwner.id))
            .run();
        }
        this.db
          .insert(managedModelInstallations)
          .values({
            id: input.id,
            provider: input.provider,
            sourceUrl: input.sourceUrl,
            providerModelId: input.providerModelId,
            providerVersionId: input.providerVersionId,
            providerFileId: input.providerFileId,
            modelName: input.modelName,
            versionName: input.versionName,
            filename: input.filename,
            destinationRootId: input.destinationRootId,
            relativeDir: input.relativeDir,
            sha256: input.sha256,
            storagePath: input.storagePath,
            installedAt: input.installedAt,
            updatedAt: input.installedAt,
          })
          .onConflictDoUpdate({
            target: [
              managedModelInstallations.provider,
              managedModelInstallations.providerModelId,
              managedModelInstallations.providerVersionId,
              managedModelInstallations.providerFileId,
            ],
            set: {
              id: input.id,
              sourceUrl: input.sourceUrl,
              modelName: input.modelName,
              versionName: input.versionName,
              filename: input.filename,
              destinationRootId: input.destinationRootId,
              relativeDir: input.relativeDir,
              sha256: input.sha256,
              storagePath: input.storagePath,
              installedAt: input.installedAt,
              updatedAt: input.installedAt,
            },
          })
          .run();
      }
      return normalized.map((input) => {
        const installation =
          this.findManagedModelInstallationByProviderFile(
            input.provider,
            input.providerModelId,
            input.providerVersionId,
            input.providerFileId,
          );
        if (!installation) {
          throw new Error("Managed model installation was not persisted.");
        }
        return installation;
      });
    })();
  }

  findManagedModelInstallation(
    id: string,
  ): ManagedModelInstallationDto | null {
    const row =
      this.db
        .select()
        .from(managedModelInstallations)
        .where(eq(managedModelInstallations.id, id))
        .get() ?? null;
    return row ? managedModelInstallationToDto(row) : null;
  }

  findManagedModelInstallationByProviderFile(
    provider: ManagedModelInstallationDto["provider"],
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string | null,
  ): ManagedModelInstallationDto | null {
    const providerFileClause =
      providerFileId === null
        ? sql`${managedModelInstallations.providerFileId} IS NULL`
        : eq(managedModelInstallations.providerFileId, providerFileId);
    const row =
      this.db
        .select()
        .from(managedModelInstallations)
        .where(
          and(
            eq(managedModelInstallations.provider, provider),
            eq(
              managedModelInstallations.providerModelId,
              providerModelId,
            ),
            eq(
              managedModelInstallations.providerVersionId,
              providerVersionId,
            ),
            providerFileClause,
          ),
        )
        .get() ?? null;
    return row ? managedModelInstallationToDto(row) : null;
  }

  findManagedModelInstallationByProviderArtifact(
    provider: ManagedModelInstallationDto["provider"],
    providerModelId: string,
    providerFileId: string,
  ): ManagedModelInstallationDto | null {
    const row =
      this.db
        .select()
        .from(managedModelInstallations)
        .where(
          and(
            eq(managedModelInstallations.provider, provider),
            eq(
              managedModelInstallations.providerModelId,
              providerModelId,
            ),
            eq(
              managedModelInstallations.providerFileId,
              providerFileId,
            ),
          ),
        )
        .orderBy(desc(managedModelInstallations.installedAt))
        .limit(1)
        .get() ?? null;
    return row ? managedModelInstallationToDto(row) : null;
  }

  listManagedModelInstallations(): ManagedModelInstallationDto[] {
    return this.db
      .select()
      .from(managedModelInstallations)
      .orderBy(desc(managedModelInstallations.installedAt))
      .all()
      .map(managedModelInstallationToDto);
  }

  deleteManagedModelInstallation(id: string): boolean {
    return Boolean(
      this.db
        .delete(managedModelInstallations)
        .where(eq(managedModelInstallations.id, id))
        .returning({ id: managedModelInstallations.id })
        .get(),
    );
  }

  deleteModelDownloadTask(id: string): boolean {
    const row = this.findModelDownloadRow(id);
    if (!row) return false;
    this.database.sqlite.transaction(() => {
      this.db
        .delete(systemOperations)
        .where(eq(systemOperations.id, row.operationId))
        .run();
      this.db.delete(modelDownloads).where(eq(modelDownloads.id, id)).run();
    })();
    return true;
  }

  createAsset(input: NewAsset): AssetRow {
    this.db.insert(assets).values(input).run();
    return this.findAsset(input.id)!;
  }

  findAsset(id: string): AssetRow | null {
    return (
      this.db.select().from(assets).where(eq(assets.id, id)).get() ?? null
    );
  }

  findAssetByHash(sha256: string): AssetRow | null {
    return (
      this.db
        .select()
        .from(assets)
        .where(eq(assets.sha256, sha256))
        .get() ?? null
    );
  }

  findAssets(ids: string[]): AssetRow[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .select()
      .from(assets)
      .where(inArray(assets.id, ids))
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  setAssetComfyFilename(id: string, comfyFilename: string): void {
    this.db
      .update(assets)
      .set({ comfyFilename })
      .where(eq(assets.id, id))
      .run();
  }

  listAssetRows(): AssetRow[] {
    return this.db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt))
      .all();
  }

  hasCompletedJobs(): boolean {
    return Boolean(
      this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.status, "completed"))
        .limit(1)
        .get(),
    );
  }

  createJob(input: NewJob): JobRow {
    this.database.sqlite.transaction(() => {
      this.db
        .insert(jobs)
        .values({
          id: input.id,
          kind: input.kind ?? "generation",
          parentJobId: input.parentJobId ?? null,
          sourceOutputId: input.sourceOutputId ?? null,
          status: "uploading",
          phase: "preparing",
          comfyClientId: input.clientId,
          configJson: JSON.stringify(input.config),
          actualSeed: input.actualSeed,
          autoTags: "",
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .run();

      if (input.assetIds.length > 0) {
        this.db
          .insert(jobAssets)
          .values(
            input.assetIds.map((assetId, ordinal) => ({
              jobId: input.id,
              assetId,
              ordinal,
            })),
          )
          .run();
      }
    })();

    return this.findJobRow(input.id)!;
  }

  updateJob(id: string, patch: JobUpdate): JobRow | null {
    const set: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.phase !== undefined) set.phase = patch.phase;
    if (patch.comfyPromptId !== undefined) {
      set.comfyPromptId = patch.comfyPromptId;
    }
    if (patch.queueNumber !== undefined) set.queueNumber = patch.queueNumber;
    if (patch.workflow !== undefined) {
      set.workflowJson =
        patch.workflow === null ? null : JSON.stringify(patch.workflow);
    }
    if (patch.nodePhases !== undefined) {
      set.nodePhasesJson =
        patch.nodePhases === null ? null : JSON.stringify(patch.nodePhases);
    }
    if (patch.nodeLabels !== undefined) {
      set.nodeLabelsJson =
        patch.nodeLabels === null ? null : JSON.stringify(patch.nodeLabels);
    }
    if (patch.outputKinds !== undefined) {
      set.outputKindsJson =
        patch.outputKinds === null ? null : JSON.stringify(patch.outputKinds);
    }
    if (patch.autoTagsNodeId !== undefined) {
      set.autoTagsNodeId = patch.autoTagsNodeId;
    }
    if (patch.autoTags !== undefined) set.autoTags = patch.autoTags;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;

    this.db.update(jobs).set(set).where(eq(jobs.id, id)).run();
    return this.findJobRow(id);
  }

  findJobRow(id: string): JobRow | null {
    return this.db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
  }

  hasJobs(): boolean {
    const row = this.database.sqlite
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM jobs")
      .get();
    return (row?.count ?? 0) > 0;
  }

  findJobByPromptId(promptId: string): JobRow | null {
    return (
      this.db
        .select()
        .from(jobs)
        .where(eq(jobs.comfyPromptId, promptId))
        .get() ?? null
    );
  }

  listActiveJobRows(): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(
        inArray(jobs.status, ["uploading", "queued", "running"] satisfies JobStatus[]),
      )
      .orderBy(asc(jobs.createdAt))
      .all();
  }

  listJobRows(query: JobListQuery = {}): JobRow[] {
    const clauses = [];
    if (query.status) clauses.push(eq(jobs.status, query.status));
    if (query.before) clauses.push(lt(jobs.createdAt, query.before));
    if (query.model) {
      clauses.push(like(jobs.configJson, `%${query.model}%`));
    }
    if (query.query) {
      const pattern = `%${query.query}%`;
      clauses.push(or(like(jobs.configJson, pattern), like(jobs.id, pattern))!);
    }

    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    return this.db
      .select()
      .from(jobs)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit + 1)
      .all();
  }

  getJobAssets(jobId: string): AssetRow[] {
    return this.db
      .select({
        id: assets.id,
        sha256: assets.sha256,
        originalName: assets.originalName,
        mimeType: assets.mimeType,
        byteSize: assets.byteSize,
        width: assets.width,
        height: assets.height,
        storagePath: assets.storagePath,
        comfyFilename: assets.comfyFilename,
        createdAt: assets.createdAt,
      })
      .from(jobAssets)
      .innerJoin(assets, eq(jobAssets.assetId, assets.id))
      .where(eq(jobAssets.jobId, jobId))
      .orderBy(asc(jobAssets.ordinal))
      .all();
  }

  addEvent(input: NewEvent): JobEventRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const result = this.db
      .insert(jobEvents)
      .values({
        jobId: input.jobId,
        phase: input.phase,
        message: input.message,
        progress: input.progress ?? null,
        current: input.current ?? null,
        total: input.total ?? null,
        payloadJson:
          input.payload === undefined ? null : JSON.stringify(input.payload),
        createdAt,
      })
      .returning()
      .get();
    return result;
  }

  listEvents(jobId: string, afterId = 0, limit = 1_000): JobEventRow[] {
    return this.db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, jobId), sql`${jobEvents.id} > ${afterId}`))
      .orderBy(asc(jobEvents.id))
      .limit(Math.min(Math.max(limit, 1), 10_000))
      .all();
  }

  latestEvent(jobId: string): JobEventRow | null {
    return (
      this.db
        .select()
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(desc(jobEvents.id))
        .limit(1)
        .get() ?? null
    );
  }

  latestPreview(jobId: string): JobPreviewDto | null {
    const row =
      this.db
        .select()
        .from(jobEvents)
        .where(
          and(
            eq(jobEvents.jobId, jobId),
            like(jobEvents.payloadJson, '%"preview"%'),
          ),
        )
        .orderBy(desc(jobEvents.id))
        .limit(1)
        .get() ?? null;
    return row ? (eventToDto(row).preview ?? null) : null;
  }

  createOutput(input: NewOutput): OutputRow {
    this.db.insert(outputs).values(input).onConflictDoNothing().run();
    return (
      this.db
        .select()
        .from(outputs)
        .where(
          and(
            eq(outputs.jobId, input.jobId),
            eq(outputs.nodeId, input.nodeId),
            eq(outputs.comfyFilename, input.comfyFilename),
            eq(outputs.comfySubfolder, input.comfySubfolder),
          ),
        )
        .get()!
    );
  }

  findOutput(id: string): OutputRow | null {
    return (
      this.db.select().from(outputs).where(eq(outputs.id, id)).get() ?? null
    );
  }

  listOutputs(jobId: string): OutputRow[] {
    return this.db
      .select()
      .from(outputs)
      .where(eq(outputs.jobId, jobId))
      .orderBy(asc(outputs.createdAt), asc(outputs.id))
      .all();
  }

  listOutputRows(): OutputRow[] {
    return this.db
      .select()
      .from(outputs)
      .orderBy(desc(outputs.createdAt))
      .all();
  }

  listModelDownloadRows(): ModelDownloadRow[] {
    return this.db
      .select()
      .from(modelDownloads)
      .orderBy(desc(modelDownloads.createdAt))
      .all();
  }

  assetDependencies(assetId: string): RepositoryDependency[] {
    const jobReferences = this.db
      .select({ id: jobs.id, createdAt: jobs.createdAt })
      .from(jobAssets)
      .innerJoin(jobs, eq(jobAssets.jobId, jobs.id))
      .where(eq(jobAssets.assetId, assetId))
      .all()
      .map((row) => ({
        kind: "job" as const,
        id: row.id,
        label: `Generation from ${toIso(row.createdAt) ?? row.createdAt}`,
      }));
    return jobReferences;
  }

  outputDependencies(outputId: string): RepositoryDependency[] {
    const jobReferences = this.db
      .select({ id: jobs.id, createdAt: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.sourceOutputId, outputId))
      .all()
      .map((row) => ({
        kind: "job" as const,
        id: row.id,
        label: `Upscale from ${toIso(row.createdAt) ?? row.createdAt}`,
      }));
    return jobReferences;
  }

  jobDependencies(jobId: string): RepositoryDependency[] {
    return this.db
      .select({ id: jobs.id, createdAt: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.parentJobId, jobId))
      .all()
      .map((row) => ({
        kind: "job" as const,
        id: row.id,
        label: `Upscale from ${toIso(row.createdAt) ?? row.createdAt}`,
      }));
  }

  modelDependencies(filename: string): RepositoryDependency[] {
    const normalized = filename.replaceAll("\\", "/").toLowerCase();
    const basename = normalized.split("/").at(-1);
    const usesModel = (values: string[]) =>
      values
        .map((value) => value.replaceAll("\\", "/").toLowerCase())
        .some(
          (value) =>
            value === normalized ||
            (basename !== undefined && value.split("/").at(-1) === basename),
        );
    const activeJobDependencies = this.db
      .select()
      .from(jobs)
      .all()
      .filter((row) => !this.isTerminal(row))
      .flatMap((row) => {
        const parsed = generationConfigSchema.safeParse(
          parseJson<unknown>(row.configJson, {}),
        );
        if (!parsed.success) return [];
        const config = parsed.data;
        const used = usesModel([
          config.model.diffusionModel,
          config.model.clip,
          config.model.vae,
          ...config.loras
            .filter((lora) => lora.enabled)
            .map((lora) => lora.name),
        ]);
        return used
          ? [
              {
                kind: "job" as const,
                id: row.id,
                label: `Active generation from ${
                  toIso(row.createdAt) ?? row.createdAt
                }`,
              },
            ]
          : [];
      });
    return activeJobDependencies;
  }

  deleteAssetRecord(id: string): boolean {
    return Boolean(
      this.db
        .delete(assets)
        .where(eq(assets.id, id))
        .returning({ id: assets.id })
        .get(),
    );
  }

  deleteOutputRecord(id: string): boolean {
    return Boolean(
      this.db
        .delete(outputs)
        .where(eq(outputs.id, id))
        .returning({ id: outputs.id })
        .get(),
    );
  }

  deleteJobRecord(id: string): boolean {
    return Boolean(
      this.db
        .delete(jobs)
        .where(eq(jobs.id, id))
        .returning({ id: jobs.id })
        .get(),
    );
  }

  toJobDto(row: JobRow): JobDto {
    const config = generationConfigSchema.parse(
      parseJson<unknown>(row.configJson, {}),
    );
    const event = this.latestEvent(row.id);
    const dto: JobDto = {
      id: row.id,
      kind: row.kind === "upscale" ? "upscale" : "generation",
      parentJobId: row.parentJobId,
      sourceOutputId: row.sourceOutputId,
      status: row.status as JobStatus,
      phase: row.phase as JobPhase,
      comfyPromptId: row.comfyPromptId,
      queueNumber: row.queueNumber,
      config,
      actualSeed: row.actualSeed,
      autoTags: row.autoTags,
      error: row.error,
      createdAt: toIso(row.createdAt) ?? row.createdAt,
      startedAt: toIso(row.startedAt),
      completedAt: toIso(row.completedAt),
      assets: this.getJobAssets(row.id).map(assetToDto),
      outputs: this.listOutputs(row.id).map(outputToDto),
    };
    if (event) dto.latestEvent = eventToDto(event);
    const preview = this.latestPreview(row.id);
    if (preview) dto.preview = preview;
    return dto;
  }

  findJob(id: string): JobDto | null {
    const row = this.findJobRow(id);
    return row ? this.toJobDto(row) : null;
  }

  isTerminal(row: JobRow): boolean {
    return terminalStatuses.has(row.status as JobStatus);
  }

  seedTags(values: readonly OfflineTag[]): void {
    if (values.length === 0) return;
    this.database.sqlite.transaction(() => {
      for (let offset = 0; offset < values.length; offset += 100) {
        const chunk = values.slice(offset, offset + 100);
        this.db
          .insert(tags)
          .values(
            chunk.map((value) => ({
              tag: value.tag,
              category: value.category,
              count: value.count,
              description: value.description,
              aliases: (value.aliases ?? []).join(", "),
            })),
          )
          .onConflictDoUpdate({
            target: tags.tag,
            set: {
              category: sql`excluded.category`,
              count: sql`excluded.count`,
              description: sql`excluded.description`,
              aliases: sql`excluded.aliases`,
            },
          })
          .run();
      }
    })();
  }

  tagIndexCounts(): { tagCount: number; cooccurrenceCount: number } {
    const row = this.database.sqlite
      .query<{ tagCount: number; cooccurrenceCount: number }, []>(
        `SELECT
           (SELECT COUNT(*) FROM tags) AS tagCount,
           (SELECT COUNT(*) FROM tag_cooccurrences) AS cooccurrenceCount`,
      )
      .get();
    return {
      tagCount: row?.tagCount ?? 0,
      cooccurrenceCount: row?.cooccurrenceCount ?? 0,
    };
  }

  tagIndexMetadata(): TagIndexMetadata | null {
    return this.getSetting<TagIndexMetadata>("tag-index");
  }

  replaceTagIndex(
    values: readonly OfflineTag[],
    cooccurrences: readonly OfflineTagCooccurrence[],
    metadata: Omit<
      TagIndexMetadata,
      "tagCount" | "cooccurrenceCount" | "importedAt"
    >,
  ): TagIndexStats {
    let tagCount = 0;
    let cooccurrenceCount = 0;
    let skippedCooccurrences = 0;

    this.database.sqlite.transaction(() => {
      this.database.sqlite.exec("DELETE FROM tag_cooccurrences");
      this.database.sqlite.exec("DELETE FROM tags");

      const insertTag = this.database.sqlite.query(
        `INSERT INTO tags(tag, category, count, description, aliases)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(tag) DO UPDATE SET
           category = excluded.category,
           count = excluded.count,
           description = excluded.description,
           aliases = excluded.aliases`,
      );
      for (const value of values) {
        insertTag.run(
          value.tag,
          value.category,
          value.count,
          value.description,
          (value.aliases ?? []).join(", "),
        );
      }

      const rows = this.database.sqlite
        .query<{ id: number; tag: string }, []>("SELECT id, tag FROM tags")
        .all();
      tagCount = rows.length;
      const idsByTag = new Map(rows.map((row) => [row.tag, row.id]));
      const insertCooccurrence = this.database.sqlite.query(
        `INSERT INTO tag_cooccurrences(tag_id, related_tag_id, count)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(tag_id, related_tag_id) DO UPDATE SET
           count = MAX(tag_cooccurrences.count, excluded.count)`,
      );
      for (const value of cooccurrences) {
        const firstId = idsByTag.get(value.tag);
        const secondId = idsByTag.get(value.relatedTag);
        if (firstId === undefined || secondId === undefined || firstId === secondId) {
          skippedCooccurrences += 1;
          continue;
        }
        const tagId = Math.min(firstId, secondId);
        const relatedTagId = Math.max(firstId, secondId);
        insertCooccurrence.run(tagId, relatedTagId, value.count);
      }
      const relationRow = this.database.sqlite
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM tag_cooccurrences",
        )
        .get();
      cooccurrenceCount = relationRow?.count ?? 0;

      const importedAt = new Date().toISOString();
      this.database.sqlite
        .query(
          `INSERT INTO settings(key, value_json, updated_at)
           VALUES ('tag-index', ?1, ?2)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          JSON.stringify({
            ...metadata,
            tagCount,
            cooccurrenceCount,
            importedAt,
          } satisfies TagIndexMetadata),
          importedAt,
        );
    })();

    return { tagCount, cooccurrenceCount, skippedCooccurrences };
  }

  private tagSuggestion(row: {
    tag: string;
    category: TagSuggestion["category"];
    count: number;
    description: string;
    aliases: string;
    cooccurrenceCount?: number;
    matchedContext?: string;
  }): TagSuggestion {
    const aliases = row.aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean);
    const matchedContext = row.matchedContext
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      tag: row.tag,
      insertText: escapeDanbooruTagForPrompt(row.tag),
      category: row.category,
      count: row.count,
      description: row.description,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(row.cooccurrenceCount !== undefined
        ? { cooccurrenceCount: row.cooccurrenceCount }
        : {}),
      ...(matchedContext && matchedContext.length > 0
        ? { matchedContext }
        : {}),
    };
  }

  private searchTagsByText(
    query: string,
    limit: number,
  ): TagSuggestion[] {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const trimmed = normalizeDanbooruTag(query).toLowerCase();
    if (!trimmed) {
      return this.db
        .select()
        .from(tags)
        .orderBy(desc(tags.count), asc(tags.tag))
        .limit(boundedLimit)
        .all()
        .map((row) =>
          this.tagSuggestion({
            ...row,
            category: row.category as TagSuggestion["category"],
          }),
        );
    }

    const tokens = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .map((token) => `"${token.replaceAll('"', '""')}"*`);
    const ftsQuery = tokens.join(" AND ");

    try {
      return this.database.sqlite
        .query<
          {
            tag: string;
            category: TagSuggestion["category"];
            count: number;
            description: string;
            aliases: string;
          },
          [string, string, number]
        >(
          `SELECT
             t.tag,
             t.category,
             t.count,
             t.description,
             t.aliases
           FROM tag_search
           JOIN tags AS t ON t.id = tag_search.rowid
           WHERE tag_search MATCH ?1
           ORDER BY
             CASE
               WHEN lower(t.tag) = ?2 THEN 0
               WHEN instr(lower(t.tag), ?2) = 1 THEN 1
               WHEN instr(lower(t.tag), ?2) > 0 THEN 2
               ELSE 3
             END ASC,
             t.count DESC,
             t.tag ASC
           LIMIT ?3`,
        )
        .all(ftsQuery, trimmed, boundedLimit)
        .map((row) => this.tagSuggestion(row));
    } catch {
      const lexicalTier = sql<number>`CASE
        WHEN lower(${tags.tag}) = ${trimmed} THEN 0
        WHEN instr(lower(${tags.tag}), ${trimmed}) = 1 THEN 1
        WHEN instr(lower(${tags.tag}), ${trimmed}) > 0 THEN 2
        ELSE 3
      END`;
      return this.db
        .select()
        .from(tags)
        .where(
          or(
            sql`instr(lower(${tags.tag}), ${trimmed}) > 0`,
            sql`instr(lower(${tags.category}), ${trimmed}) > 0`,
            sql`instr(lower(${tags.aliases}), ${trimmed}) > 0`,
            sql`instr(lower(${tags.description}), ${trimmed}) > 0`,
          ),
        )
        .orderBy(lexicalTier, desc(tags.count), asc(tags.tag))
        .limit(boundedLimit)
        .all()
        .map((row) =>
          this.tagSuggestion({
            ...row,
            category: row.category as TagSuggestion["category"],
          }),
        );
    }
  }

  relatedTags(
    context: readonly string[],
    query = "",
    limit = 20,
  ): TagSuggestion[] {
    const normalizedContext = [
      ...new Set(
        context
          .map(normalizeDanbooruTag)
          .map((tag) => tag.toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 16);
    if (normalizedContext.length === 0) return [];

    const contextPlaceholders = normalizedContext.map(() => "?").join(", ");
    const contextRows = this.database.sqlite
      .query(
        `SELECT id, tag FROM tags
         WHERE tag IN (${contextPlaceholders})`,
      )
      .all(...normalizedContext) as Array<{ id: number; tag: string }>;
    if (contextRows.length === 0) return [];

    const contextIds = contextRows.map((row) => row.id);
    const idPlaceholders = contextIds.map(() => "?").join(", ");
    const trimmedQuery = normalizeDanbooruTag(query).toLowerCase();
    const queryClause = trimmedQuery
      ? `AND (
          instr(lower(t.tag), ?) > 0 OR
          instr(lower(t.category), ?) > 0 OR
          instr(lower(t.description), ?) > 0 OR
          instr(lower(t.aliases), ?) > 0
        )`
      : "";
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const parameters: Array<string | number> = [
      ...contextIds,
      ...contextIds,
      ...contextIds,
      ...(trimmedQuery
        ? [trimmedQuery, trimmedQuery, trimmedQuery, trimmedQuery]
        : []),
      boundedLimit,
    ];
    const rows = this.database.sqlite
      .query(
        `WITH relation(candidate_id, anchor_id, relation_count) AS (
           SELECT related_tag_id, tag_id, count
           FROM tag_cooccurrences
           WHERE tag_id IN (${idPlaceholders})
           UNION ALL
           SELECT tag_id, related_tag_id, count
           FROM tag_cooccurrences
           WHERE related_tag_id IN (${idPlaceholders})
         )
         SELECT
           t.tag,
           t.category,
           t.count,
           t.description,
           t.aliases,
           SUM(relation.relation_count) AS cooccurrenceCount,
           GROUP_CONCAT(DISTINCT anchor.tag) AS matchedContext
         FROM relation
         JOIN tags AS t ON t.id = relation.candidate_id
         JOIN tags AS anchor ON anchor.id = relation.anchor_id
         WHERE t.id NOT IN (${idPlaceholders})
           ${queryClause}
         GROUP BY t.id
         ORDER BY
           COUNT(DISTINCT relation.anchor_id) DESC,
           SUM(relation.relation_count) DESC,
           t.count DESC,
           t.tag ASC
         LIMIT ?`,
      )
      .all(...parameters) as Array<{
      tag: string;
      category: TagSuggestion["category"];
      count: number;
      description: string;
      aliases: string;
      cooccurrenceCount: number;
      matchedContext: string;
    }>;
    return rows.map((row) => this.tagSuggestion(row));
  }

  searchTags(
    query: string,
    limit = 20,
    context: readonly string[] = [],
  ): TagSuggestion[] {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const normalizedQuery = normalizeDanbooruTag(query).toLowerCase();
    const textMatches = this.searchTagsByText(
      query,
      context.length > 0 ? Math.min(boundedLimit * 3, 50) : boundedLimit,
    );
    if (context.length === 0) return textMatches.slice(0, boundedLimit);

    const relatedMatches = this.relatedTags(context, query, 50);
    const merged = new Map(textMatches.map((entry) => [entry.tag, entry]));
    for (const entry of relatedMatches) {
      merged.set(entry.tag, { ...merged.get(entry.tag), ...entry });
    }
    return [...merged.values()]
      .sort((left, right) => {
        const tierDifference =
          tagLexicalTier(left.tag, normalizedQuery) -
          tagLexicalTier(right.tag, normalizedQuery);
        if (tierDifference !== 0) return tierDifference;
        const matchedDifference =
          (right.matchedContext?.length ?? 0) -
          (left.matchedContext?.length ?? 0);
        if (matchedDifference !== 0) return matchedDifference;
        const relationDifference =
          (right.cooccurrenceCount ?? 0) - (left.cooccurrenceCount ?? 0);
        if (relationDifference !== 0) return relationDifference;
        const countDifference = right.count - left.count;
        if (countDifference !== 0) return countDifference;
        return compareTagNames(left.tag, right.tag);
      })
      .slice(0, boundedLimit);
  }

  parseNodePhases(row: JobRow): Record<string, JobPhase> {
    return parseJson<Record<string, JobPhase>>(row.nodePhasesJson, {});
  }

  parseOutputKinds(row: JobRow): Record<string, "base" | "upscale"> {
    return parseJson<Record<string, "base" | "upscale">>(
      row.outputKindsJson,
      {},
    );
  }

  parseNodeLabels(row: JobRow): Record<string, string> {
    return parseJson<Record<string, string>>(row.nodeLabelsJson, {});
  }
}
