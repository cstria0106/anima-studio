import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  MANAGED_ENGINE_MANIFEST,
  resolveRuntimeRootPaths,
  type EngineManifest,
  type RuntimeState as ManagedRuntimeState,
} from "@anima/runtime";
import {
  CURATED_IMAGE_PRESETS,
  civitaiInspectRequestSchema,
  huggingFaceAnimaDownloadCreateSchema,
  modelDownloadCreateSchema,
  runtimeConfigSchema,
  type JobStatus,
  type RuntimeConfig,
  type RuntimeDto,
  type RuntimeHardwareDto,
} from "@anima/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import { ComfyClient, type ComfyClientLike } from "./comfy/client";
import { SwitchableComfyGateway } from "./comfy/gateway";
import type { ComfyObjectInfo } from "./comfy/types";
import { createDatabase, type DatabaseContext } from "./db/database";
import { StudioRepository } from "./db/repository";
import { JobEventBroker } from "./events/broker";
import { FileStorage } from "./files/storage";
import { createZipStream, uniqueZipNames } from "./files/zip";
import {
  CivitaiApiClient,
  DirectCivitaiDownloadClient,
  CivitaiError,
  CivitaiModelLibraryService,
  CivitaiTokenService,
  DestinationRegistry,
  DpapiFileSecretStore,
  FetchCivitaiHttpTransport,
  NodeFileHasher,
  QuarantineInvalidDownloadHandler,
  type SecretStore,
} from "./civitai";
import {
  errorResponse,
  RuntimeRequestError,
} from "./http/errors";
import {
  HttpRuntimeReadinessProbe,
  ManagedComfyRuntimeController,
  ManagedRuntimeInstaller,
  ManagedRuntimeSupervisor,
  RuntimeLogService,
  VerifiedResumableFileDownloader,
} from "./runtime";
import {
  RUNTIME_STATE_SETTING,
  StudioRuntimeActiveJobs,
  StudioRuntimeStateRepository,
} from "./runtime/studio";
import { CapabilityService } from "./services/capabilities";
import { JobEventService } from "./services/job-events";
import { JobService, JobSubmissionError } from "./services/jobs";
import { LibraryService } from "./services/library";
import { ModelDownloadCoordinator } from "./services/model-downloads";
import { OperationService } from "./services/operations";
import { StorageInventoryService } from "./services/storage-inventory";
import {
  initializeDanbooruTagIndex,
  initializeFallbackTagIndex,
} from "./services/tag-index";
import { JobTracker } from "./services/tracker";
import {
  FetchHuggingFaceJsonTransport,
  HuggingFaceAnimaClient,
  HuggingFaceAnimaLibraryService,
  HuggingFaceError,
} from "./huggingface";
import {
  PortableWorkflowEngine,
  type WorkflowEngine,
} from "./workflow/engine";
import type { EmbeddedStaticSite } from "./portable/static";
import type { GitHubUpdateService } from "./portable/update";
import { MIT_LICENSE } from "./portable/license";

export interface ApiRuntime {
  app: Hono;
  config: AppConfig;
  database: DatabaseContext;
  repository: StudioRepository;
  storage: FileStorage;
  comfy: ComfyClientLike;
  workflow: WorkflowEngine;
  capabilities: CapabilityService;
  events: JobEventService;
  operations: OperationService;
  jobs: JobService;
  library: LibraryService;
  storageInventory: StorageInventoryService;
  tracker: JobTracker;
  runtimeController: ManagedComfyRuntimeController;
  modelLibrary: ModelLibraryService;
  huggingFaceLibrary: HuggingFaceLibraryService;
  modelDownloads: ModelDownloadCoordinator;
  close(): Promise<void>;
}

export interface RuntimeOverrides {
  config?: AppConfig;
  database?: DatabaseContext;
  repository?: StudioRepository;
  storage?: FileStorage;
  comfy?: ComfyClientLike;
  workflow?: WorkflowEngine;
  broker?: JobEventBroker;
  clientId?: string;
  startTracker?: boolean;
  tagDataMode?: "configured" | "fallback";
  secretStore?: SecretStore;
  modelLibrary?: ModelLibraryService;
  huggingFaceLibrary?: HuggingFaceLibraryService;
  logger?: Pick<Console, "info" | "warn" | "error">;
  portableApp?: PortableAppServices;
}

export interface PortableAppServices {
  id: string;
  version: string;
  repositoryUrl: string;
  dataDir: string;
  instanceToken: string;
  port(): number;
  updates: GitHubUpdateService;
  staticSite: EmbeddedStaticSite;
  thirdPartyNotices: string;
}

export type ModelLibraryService = Pick<
  CivitaiModelLibraryService,
  | "providerStatus"
  | "setToken"
  | "deleteToken"
  | "inspect"
  | "create"
  | "settled"
  | "shutdown"
  | "getLoraMetadata"
  | "downloadLoraThumbnail"
>;

export type HuggingFaceLibraryService = Pick<
  HuggingFaceAnimaLibraryService,
  | "providerStatus"
  | "catalog"
  | "install"
  | "settled"
  | "shutdown"
>;

export const RUNTIME_CONFIG_SETTING = "runtime-config-v1";
export const UI_PREFERENCES_SETTING = "ui-preferences-v1";
const DEFAULT_EXTERNAL_COMFY_URL = "http://127.0.0.1:8188";

const SETTINGS_SECTIONS = new Set(["overview", "runtime", "storage"]);

interface UiPreferences {
  draft?: Record<string, unknown>;
  blurSensitive?: boolean;
  completionNotificationsEnabled?: boolean;
  settingsSection?: string;
  historySidebarWidth?: number;
}

function uiPreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: UiPreferences = {};
  if (
    input.draft &&
    typeof input.draft === "object" &&
    !Array.isArray(input.draft)
  ) {
    result.draft = input.draft as Record<string, unknown>;
  }
  if (typeof input.blurSensitive === "boolean") {
    result.blurSensitive = input.blurSensitive;
  }
  if (typeof input.completionNotificationsEnabled === "boolean") {
    result.completionNotificationsEnabled =
      input.completionNotificationsEnabled;
  }
  if (
    typeof input.settingsSection === "string" &&
    SETTINGS_SECTIONS.has(input.settingsSection)
  ) {
    result.settingsSection = input.settingsSection;
  }
  if (
    typeof input.historySidebarWidth === "number" &&
    Number.isInteger(input.historySidebarWidth) &&
    input.historySidebarWidth >= 280 &&
    input.historySidebarWidth <= 560
  ) {
    result.historySidebarWidth = input.historySidebarWidth;
  }
  return result;
}

function uiPreferencesPatch(value: unknown): UiPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeRequestError(
      "UI preferences must be a JSON object.",
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const supported = new Set([
    "draft",
    "blurSensitive",
    "completionNotificationsEnabled",
    "settingsSection",
    "historySidebarWidth",
  ]);
  if (Object.keys(input).some((key) => !supported.has(key))) {
    throw new RuntimeRequestError(
      "UI preferences contain an unsupported field.",
      400,
    );
  }
  const result = uiPreferences(input);
  if (Object.keys(result).length !== Object.keys(input).length) {
    throw new RuntimeRequestError(
      "UI preferences contain an invalid value.",
      400,
    );
  }
  return result;
}

function configuredRuntimeManifest(config: AppConfig): EngineManifest {
  if (
    config.managedRuntimePortStart > 65_535 ||
    config.managedRuntimePortEnd > 65_535 ||
    config.managedRuntimePortEnd < config.managedRuntimePortStart
  ) {
    throw new Error(
      "Managed runtime ports must form a valid TCP port range.",
    );
  }
  return {
    ...MANAGED_ENGINE_MANIFEST,
    platform: {
      ...MANAGED_ENGINE_MANIFEST.platform,
      minimumFreeBytes: Math.max(
        MANAGED_ENGINE_MANIFEST.platform.minimumFreeBytes,
        config.managedRuntimeMinimumFreeBytes,
      ),
    },
    launch: {
      ...MANAGED_ENGINE_MANIFEST.launch,
      portRange: {
        from: config.managedRuntimePortStart,
        to: config.managedRuntimePortEnd,
      },
      readinessTimeoutMs: config.managedRuntimeStartTimeoutMs,
    },
  };
}

function savedRuntimeState(value: unknown): ManagedRuntimeState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ManagedRuntimeState>;
  if (
    (candidate.mode !== "managed" && candidate.mode !== "external") ||
    typeof candidate.status !== "string" ||
    typeof candidate.endpoint !== "string"
  ) {
    return null;
  }
  return value as ManagedRuntimeState;
}

function initialRuntimeConfig(
  repository: StudioRepository,
  config: AppConfig,
): RuntimeConfig {
  const stored = runtimeConfigSchema.safeParse(
    repository.getSetting<unknown>(RUNTIME_CONFIG_SETTING),
  );
  const state = savedRuntimeState(
    repository.getSetting<unknown>(RUNTIME_STATE_SETTING),
  );
  const existingInstallation = repository.hasJobs();
  const mode =
    state?.mode ??
    (stored.success ? stored.data.mode : null) ??
    (existingInstallation ? "external" : "managed");
  const externalUrl =
    mode === "external"
      ? state?.mode === "external"
        ? state.endpoint
        : stored.success
          ? stored.data.externalUrl ?? DEFAULT_EXTERNAL_COMFY_URL
          : DEFAULT_EXTERNAL_COMFY_URL
      : null;
  const selectedPort =
    mode === "managed"
      ? state?.mode === "managed"
        ? state.port
        : stored.success
          ? stored.data.port
          : config.managedRuntimePortStart
      : null;
  return runtimeConfigSchema.parse({
    mode,
    externalUrl,
    autoStart: stored.success ? stored.data.autoStart : true,
    stopWithApi: stored.success ? stored.data.stopWithApi : true,
    port: selectedPort,
  });
}

function modelDownloadUnavailableReason(
  state: ManagedRuntimeState,
): string | null {
  if (state.mode !== "managed") {
    return "Model downloads require the app-managed ComfyUI runtime.";
  }
  return null;
}

function shouldAutoStartManagedRuntime(
  state: ManagedRuntimeState,
  currentBundleId: string,
  autoStart: boolean,
): boolean {
  return (
    autoStart &&
    state.mode === "managed" &&
    state.activeBundleId === currentBundleId &&
    !state.process
  );
}

async function runtimeDto(
  controller: ManagedComfyRuntimeController,
  gateway: SwitchableComfyGateway,
  config: RuntimeConfig,
  hardware: RuntimeHardwareDto | null,
): Promise<RuntimeDto> {
  const status = await controller.status();
  const state = status.state;
  const connected = gateway.available
    ? await gateway.health().catch(() => false)
    : false;
  const ready =
    state.mode === "external"
      ? connected
      : state.status === "ready" && connected;
  const displayState =
    state.mode === "external"
      ? ready
        ? "ready"
        : state.error
          ? "failed"
          : "stopped"
      : state.status === "ready" && !ready
        ? "failed"
        : state.status;
  const comfyVersion =
    controller.manifest.artifacts.find(
      (artifact) => artifact.id === "comfyui",
    )?.version ?? null;
  return {
    mode: state.mode,
    state: displayState,
    installed: status.managed.installed,
    ready,
    bundleId: state.activeBundleId,
    comfyVersion:
      state.mode === "managed" && status.managed.installed
        ? comfyVersion
        : null,
    comfyUrl: state.endpoint,
    externalUrl:
      state.mode === "external" ? config.externalUrl ?? state.endpoint : null,
    port: state.port,
    pid: state.process?.pid ?? null,
    startedAt: state.process?.startedAt ?? null,
    error:
      state.status === "ready" && !ready
        ? "Managed ComfyUI is not responding."
        : state.error,
    autoStart: config.autoStart,
    stopWithApi: config.stopWithApi,
    hardware,
    activeOperationId: state.operationId,
  };
}

function reconcileInterruptedRuntimeOperations(
  repository: StudioRepository,
  operations: OperationService,
): void {
  const message =
    "The API restarted before this operation completed. Retry the operation.";
  for (const operation of repository
    .listActiveSystemOperations()
    .filter((candidate) => candidate.kind !== "model_download")) {
    operations.fail(operation.id, new Error(message), "failed");
  }
}

function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_").replaceAll('"', "'");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function attachmentDisposition(filename: string): string {
  return inlineDisposition(filename).replace(/^inline;/, "attachment;");
}

function numberParameter(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function tokensMatch(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function tagContextParameter(...rawValues: Array<string | undefined>): string[] {
  return [
    ...new Set(
      rawValues
        .filter((value): value is string => Boolean(value))
        .join(",")
        .slice(0, 2_000)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 16);
}

function persistentComfyClientId(
  repository: StudioRepository,
  override?: string,
): string {
  if (override) return override;
  const saved = repository.getSetting<unknown>("comfy-client-id");
  if (typeof saved === "string" && saved.trim()) return saved;
  const generated = `anima-studio-${crypto.randomUUID()}`;
  repository.setSetting("comfy-client-id", generated);
  return generated;
}

export async function createRuntime(
  overrides: RuntimeOverrides = {},
): Promise<ApiRuntime> {
  const config = overrides.config ?? loadConfig();
  const ownsDatabase = !overrides.database;
  const database = overrides.database ?? createDatabase(config);
  const repository = overrides.repository ?? new StudioRepository(database);
  const tagIndex =
    overrides.tagDataMode === "fallback"
      ? initializeFallbackTagIndex(repository)
      : await initializeDanbooruTagIndex(repository, {
          tagsCsvPath: config.danbooruTagsCsvPath,
          descriptionsCsvPath: config.danbooruDescriptionsCsvPath,
          cooccurrenceCsvPath: config.danbooruCooccurrenceCsvPath,
          ...(config.danbooruTagDataFingerprint
            ? {
                contentFingerprint:
                  config.danbooruTagDataFingerprint,
              }
            : {}),
          minimumCooccurrenceCount:
            config.danbooruMinimumCooccurrenceCount,
        });
  if (tagIndex.imported) {
    (overrides.logger ?? console).info(
      `Loaded ${tagIndex.stats.tagCount} tags and ` +
        `${tagIndex.stats.cooccurrenceCount} cooccurrences.`,
    );
  }
  const storage =
    overrides.storage ??
    new FileStorage(
      {
        dataDir: config.dataDir,
        maxUploadBytes: config.maxUploadBytes,
        maxImageDimension: config.maxImageDimension,
        maxImagePixels: config.maxImagePixels,
      },
      repository,
  );
  await storage.initialize();
  const workflow = overrides.workflow ?? new PortableWorkflowEngine();
  const broker = overrides.broker ?? new JobEventBroker();
  const events = new JobEventService(repository, broker);
  const operations = new OperationService(repository);
  reconcileInterruptedRuntimeOperations(repository, operations);

  let runtimeConfig = initialRuntimeConfig(repository, config);
  repository.setSetting(RUNTIME_CONFIG_SETTING, runtimeConfig);
  const manifest = configuredRuntimeManifest(config);
  const runtimePaths = resolveRuntimeRootPaths(config.runtimeDir);
  const initialEndpoint =
    runtimeConfig.mode === "external"
      ? runtimeConfig.externalUrl ?? DEFAULT_EXTERNAL_COMFY_URL
      : `http://${manifest.launch.host}:${
          runtimeConfig.port ?? manifest.launch.portRange.from
        }`;
  const runtimeRepository = new StudioRuntimeStateRepository(
    repository,
    operations,
    runtimePaths,
    {
      initialMode: runtimeConfig.mode,
      initialEndpoint,
      bundleId: manifest.bundleId,
    },
  );
  const initialState = runtimeRepository.getState();
  if (
    initialState.mode === "managed" &&
    !initialState.process &&
    [
      "installing",
      "starting",
      "ready",
      "stopping",
      "updating",
      "repairing",
    ].includes(initialState.status)
  ) {
    runtimeRepository.patchState({
      status: initialState.activeBundleId ? "stopped" : "not_installed",
      operationId: null,
      error:
        "The API restarted before the previous runtime operation completed.",
    });
  }
  if (
    runtimeRepository.getState().mode === "managed" &&
    runtimeRepository.getState().port === null &&
    runtimeConfig.port !== null
  ) {
    runtimeRepository.patchState({
      port: runtimeConfig.port,
      endpoint: `http://${manifest.launch.host}:${runtimeConfig.port}`,
    });
  }

  const suppliedComfy = overrides.comfy;
  const gateway = new SwitchableComfyGateway({
    initialUrl: runtimeRepository.getState().endpoint,
    requestTimeoutMs: config.requestTimeoutMs,
    ...(suppliedComfy
      ? {
          createClient: (url: string) =>
            url.replace(/\/+$/, "") ===
            suppliedComfy.baseUrl.replace(/\/+$/, "")
              ? suppliedComfy
              : new ComfyClient({
                  comfyUrl: url,
                  requestTimeoutMs: config.requestTimeoutMs,
                }),
        }
      : {}),
  });
  gateway.setAvailable(runtimeRepository.getState().mode === "external");
  const capabilities = new CapabilityService(gateway, workflow);

  const secrets =
    overrides.secretStore ??
    new DpapiFileSecretStore(join(config.dataDir, "secrets"));
  const tokenService = new CivitaiTokenService(secrets);
  const logs = new RuntimeLogService({ directory: runtimePaths.logs });
  const installer = new ManagedRuntimeInstaller({
    paths: runtimePaths,
    repository: runtimeRepository,
    manifest,
  });
  let hardwareCache:
    | { value: RuntimeHardwareDto; expiresAt: number }
    | null = null;
  const runtimeHardware = async (): Promise<RuntimeHardwareDto> => {
    if (hardwareCache && hardwareCache.expiresAt > Date.now()) {
      return hardwareCache.value;
    }
    let value: RuntimeHardwareDto;
    try {
      const preflight = await installer.preflight();
      const primaryGpu = preflight.nvidiaDevices[0] ?? null;
      value = {
        platform: preflight.platform,
        architecture: preflight.architecture,
        supported: preflight.compatible,
        gpuName: primaryGpu?.name ?? null,
        driverVersion: null,
        vramBytes:
          primaryGpu?.vramMiB === null ||
          primaryGpu?.vramMiB === undefined
            ? null
            : primaryGpu.vramMiB * 1024 * 1024,
        freeDiskBytes: preflight.freeBytes,
        warnings: preflight.issues.map((issue) => issue.message),
      };
    } catch {
      value = {
        platform: process.platform,
        architecture: process.arch,
        supported: false,
        gpuName: null,
        driverVersion: null,
        vramBytes: null,
        freeDiskBytes: null,
        warnings: ["Managed runtime hardware diagnostics failed."],
      };
    }
    hardwareCache = {
      value,
      expiresAt: Date.now() + 30_000,
    };
    return value;
  };
  const readiness = new HttpRuntimeReadinessProbe(fetch, (objectInfo) => {
    const report = workflow.capabilities(
      objectInfo as ComfyObjectInfo,
      runtimeRepository.getState().endpoint,
    );
    if (!report.compatible) {
      throw new Error(
        report.missing.map((item) => item.label).join(" ") ||
          "Managed ComfyUI node contracts are incompatible.",
      );
    }
  });
  const supervisor = new ManagedRuntimeSupervisor({
    paths: runtimePaths,
    repository: runtimeRepository,
    logs,
    manifest,
    readiness,
    jobs: new StudioRuntimeActiveJobs(repository),
    gracefulStopMs: config.managedRuntimeStopTimeoutMs,
  });
  const runtimeController = new ManagedComfyRuntimeController({
    repository: runtimeRepository,
    installer,
    supervisor,
    logs,
    manifest,
  });

  const clientId = persistentComfyClientId(
    repository,
    overrides.clientId,
  );
  const tracker = new JobTracker(
    repository,
    storage,
    gateway,
    events,
    clientId,
    {
      queuePollMs: config.queuePollMs,
      ...(overrides.logger ? { logger: overrides.logger } : {}),
    },
  );
  const jobs = new JobService(
    repository,
    storage,
    gateway,
    workflow,
    capabilities,
    events,
    clientId,
  );
  jobs.setSubmissionListener((jobId) => tracker.refreshJob(jobId));

  const modelDestinations = new DestinationRegistry([
    {
      id: "loras",
      label: "LoRA",
      kind: "loras",
      absolutePath: join(runtimePaths.models, "loras"),
    },
    {
      id: "checkpoints",
      label: "Checkpoint",
      kind: "checkpoints",
      absolutePath: join(runtimePaths.models, "checkpoints"),
    },
    {
      id: "diffusion_models",
      label: "Diffusion model",
      kind: "diffusion_models",
      absolutePath: join(runtimePaths.models, "diffusion_models"),
    },
    {
      id: "text_encoders",
      label: "Text Encoder",
      kind: "text_encoders",
      absolutePath: join(runtimePaths.models, "text_encoders"),
    },
    {
      id: "vae",
      label: "VAE",
      kind: "vae",
      absolutePath: join(runtimePaths.models, "vae"),
    },
  ]);
  const modelLibrary =
    overrides.modelLibrary ??
    new CivitaiModelLibraryService(
      new CivitaiApiClient(new FetchCivitaiHttpTransport(), secrets),
      tokenService,
      new DirectCivitaiDownloadClient(secrets),
      modelDestinations,
      new NodeFileHasher(),
      new QuarantineInvalidDownloadHandler(
        join(config.dataDir, "quarantine", "model-downloads"),
      ),
      repository,
      operations,
    );
  const huggingFaceLibrary =
    overrides.huggingFaceLibrary ??
    new HuggingFaceAnimaLibraryService(
      new HuggingFaceAnimaClient(
        new FetchHuggingFaceJsonTransport(
          fetch,
          config.requestTimeoutMs,
        ),
      ),
      new VerifiedResumableFileDownloader(fetch),
      modelDestinations,
      repository,
      operations,
    );
  const modelDownloads = new ModelDownloadCoordinator(
    repository,
    modelLibrary,
    huggingFaceLibrary,
    modelDestinations,
    join(config.dataDir, "quarantine", "model-removals"),
    new NodeFileHasher(),
    () => capabilities.invalidate(),
  );
  const storageInventory = new StorageInventoryService(repository, {
    dataDir: config.dataDir,
    modelRoots: [runtimePaths.models],
    loraRoot: join(runtimePaths.models, "loras"),
  });
  const library = new LibraryService(repository, storage);
  await library.pruneEmptyTerminalJobs();
  await modelDownloads.reconcileInstallations();
  for (const orphan of repository.listActiveSystemOperations()) {
    operations.fail(
      orphan.id,
      new Error(
        "The API restarted before this operation completed. Retry the operation.",
      ),
      "interrupted",
    );
  }

  const trackerEnabled = overrides.startTracker !== false;
  const syncGateway = async (
    state: ManagedRuntimeState,
  ): Promise<void> => {
    const endpointChanged = gateway.switchTo(state.endpoint);
    const availabilityChanged = gateway.setAvailable(
      state.mode === "external" ||
        (state.status === "ready" && state.process !== null),
    );
    const changed = endpointChanged || availabilityChanged;
    capabilities.invalidate();
    if (!gateway.available) {
      tracker.stop();
    } else if (trackerEnabled && changed) {
      if (tracker.running) {
        await tracker.reconnect();
      } else {
        await tracker.start();
      }
    }
  };

  let recoveredState = await runtimeController.recover();
  if (
    shouldAutoStartManagedRuntime(
      recoveredState,
      runtimeController.manifest.bundleId,
      runtimeConfig.autoStart,
    )
  ) {
    try {
      recoveredState = await runtimeController.start();
    } catch (error) {
      (overrides.logger ?? console).warn(
        "Managed ComfyUI auto-start failed.",
        error,
      );
    }
  }
  await syncGateway(recoveredState);

  const app = createApp({
    config,
    database,
    repository,
    storage,
    comfy: gateway,
    gateway,
    capabilities,
    events,
    operations,
    jobs,
    library,
    storageInventory,
    tracker,
    runtimeController,
    runtimeLogs: logs,
    runtimeRepository,
    runtimeConfig: () => runtimeConfig,
    runtimeHardware,
    setRuntimeConfig: (value) => {
      runtimeConfig = value;
      repository.setSetting(RUNTIME_CONFIG_SETTING, value);
    },
    syncGateway,
    modelLibrary,
    huggingFaceLibrary,
    modelDownloads,
    ...(overrides.portableApp ? { portableApp: overrides.portableApp } : {}),
  });

  if (trackerEnabled && gateway.available && !tracker.running) {
    await tracker.start();
  }
  return {
    app,
    config,
    database,
    repository,
    storage,
    comfy: gateway,
    workflow,
    capabilities,
    events,
    operations,
    jobs,
    library,
    storageInventory,
    tracker,
    runtimeController,
    modelLibrary,
    huggingFaceLibrary,
    modelDownloads,
    close: async () => {
      tracker.stop();
      await Promise.all([
        modelLibrary.shutdown(),
        huggingFaceLibrary.shutdown(),
      ]);
      await runtimeController.close({
        stopRuntime: runtimeConfig.stopWithApi,
      });
      if (ownsDatabase) database.close();
    },
  };
}

interface AppServices {
  config: AppConfig;
  database: DatabaseContext;
  repository: StudioRepository;
  storage: FileStorage;
  comfy: ComfyClientLike;
  gateway: SwitchableComfyGateway;
  capabilities: CapabilityService;
  events: JobEventService;
  operations: OperationService;
  jobs: JobService;
  library: LibraryService;
  storageInventory: StorageInventoryService;
  tracker: JobTracker;
  runtimeController: ManagedComfyRuntimeController;
  runtimeLogs: RuntimeLogService;
  runtimeRepository: StudioRuntimeStateRepository;
  runtimeConfig(): RuntimeConfig;
  runtimeHardware(): Promise<RuntimeHardwareDto>;
  setRuntimeConfig(value: RuntimeConfig): void;
  syncGateway(state: ManagedRuntimeState): Promise<void>;
  modelLibrary: ModelLibraryService;
  huggingFaceLibrary: HuggingFaceLibraryService;
  modelDownloads: ModelDownloadCoordinator;
  portableApp?: PortableAppServices;
}

export function createApp(services: AppServices): Hono {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !isLocalOrigin(origin)) {
      return c.json(
        {
          message: "Cross-origin API requests are not allowed.",
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Cross-origin API requests are not allowed.",
          },
        },
        403,
      );
    }
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (!origin || isLocalOrigin(origin) ? origin : ""),
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
    }),
  );
  app.onError((error, c) => errorResponse(c, error));

  const runtimeResponse = () =>
    services.runtimeHardware().then((hardware) =>
      runtimeDto(
        services.runtimeController,
        services.gateway,
        services.runtimeConfig(),
        hardware,
      ),
    );

  const activeManagedOperations = () =>
    services.repository
      .listActiveSystemOperations()
      .filter(
        (operation) =>
          operation.kind === "runtime_install" ||
          operation.kind === "runtime_update" ||
          operation.kind === "runtime_repair" ||
          operation.kind === "model_download",
      );

  const assertRuntimeControlAvailable = (
    action: "configure" | "stop" | "restart" | "install",
  ) => {
    const operations = activeManagedOperations();
    if (operations.length > 0) {
      throw new RuntimeRequestError(
        `Cannot ${action} ComfyUI while a managed operation is active.`,
        409,
        {
          operationIds: operations.map((operation) => operation.id),
        },
      );
    }
    if (
      action === "configure" &&
      services.repository.listActiveJobRows().length > 0
    ) {
      throw new RuntimeRequestError(
        "Cannot change the ComfyUI runtime while generation jobs are active.",
        409,
      );
    }
  };

  const parseJson = async (request: Request): Promise<unknown> => {
    const text = await request.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RuntimeRequestError(
        "Request body must be valid JSON.",
        400,
      );
    }
  };

  app.get("/api/ui-preferences", (c) =>
    c.json({
      preferences: uiPreferences(
        services.repository.getSetting<unknown>(UI_PREFERENCES_SETTING),
      ),
    }),
  );

  app.put("/api/ui-preferences", async (c) => {
    const patch = uiPreferencesPatch(await parseJson(c.req.raw));
    const current = uiPreferences(
      services.repository.getSetting<unknown>(UI_PREFERENCES_SETTING),
    );
    const preferences = { ...current, ...patch };
    services.repository.setSetting(UI_PREFERENCES_SETTING, preferences);
    return c.json({ preferences });
  });

  app.get("/api/comfy/runtime", async (c) =>
    c.json({ runtime: await runtimeResponse() }),
  );

  app.put("/api/comfy/runtime", async (c) => {
    const parsed = runtimeConfigSchema.safeParse(
      await parseJson(c.req.raw),
    );
    if (!parsed.success) {
      throw new RuntimeRequestError(
        "Runtime configuration is invalid.",
        400,
        parsed.error.flatten(),
      );
    }
    const current = await services.runtimeController.status();
    if (current.state.process) {
      const managedPort =
        parsed.data.port ??
        services.runtimeController.manifest.launch.portRange.from;
      const managedEndpoint =
        `http://${services.runtimeController.manifest.launch.host}:` +
        managedPort;
      const preservesRunningTarget =
        parsed.data.mode === "managed" &&
        current.state.mode === "managed" &&
        current.state.port === managedPort &&
        current.state.endpoint === managedEndpoint;
      if (!preservesRunningTarget) {
        throw new RuntimeRequestError(
          "Stop managed ComfyUI before changing runtime configuration.",
          409,
        );
      }
      services.setRuntimeConfig(parsed.data);
      return c.json({ runtime: await runtimeResponse() });
    }
    assertRuntimeControlAvailable("configure");
    let configured;
    try {
      configured = await services.runtimeController.configure(
        parsed.data.mode === "external"
          ? {
              mode: "external",
              endpoint: parsed.data.externalUrl!,
            }
          : {
              mode: "managed",
              port:
                parsed.data.port ??
                services.runtimeController.manifest.launch.portRange.from,
            },
      );
    } catch (error) {
      throw new RuntimeRequestError(
        error instanceof Error
          ? error.message
          : "Runtime configuration could not be updated.",
        409,
      );
    }
    services.setRuntimeConfig(parsed.data);
    await services.syncGateway(configured.state);
    return c.json({ runtime: await runtimeResponse() });
  });

  const installAction = async (
    action: "install" | "update" | "repair",
  ) => {
    assertRuntimeControlAvailable("install");
    const state = (await services.runtimeController.status()).state;
    if (state.mode !== "managed") {
      throw new RuntimeRequestError(
        "Managed runtime operations are disabled in external ComfyUI mode.",
        409,
      );
    }
    if (state.process) {
      throw new RuntimeRequestError(
        "Stop managed ComfyUI before installing, updating, or repairing it.",
        409,
      );
    }
    const id = crypto.randomUUID();
    const kind = `runtime_${action}` as
      | "runtime_install"
      | "runtime_update"
      | "runtime_repair";
    services.operations.createWithId(
      id,
      kind,
      "queued",
      `Managed runtime ${action} queued.`,
      {
        bundleId: services.runtimeController.manifest.bundleId,
      },
    );
    try {
      services.runtimeController[action](id);
    } catch (error) {
      services.operations.fail(id, error, "failed");
      throw error;
    }
    void services.runtimeController
      .waitOperation(id)
      .then(async () => {
        services.capabilities.invalidate();
        const completed = (
          await services.runtimeController.status()
        ).state;
        if (
          shouldAutoStartManagedRuntime(
            completed,
            services.runtimeController.manifest.bundleId,
            services.runtimeConfig().autoStart,
          )
        ) {
          const started = await services.runtimeController.start();
          await services.syncGateway(started);
        } else {
          await services.syncGateway(completed);
        }
      })
      .catch(() => undefined);
    return {
      runtime: await runtimeResponse(),
      operation: services.operations.get(id),
    };
  };

  app.post("/api/comfy/runtime/install", async (c) =>
    c.json(await installAction("install"), 202),
  );
  app.post("/api/comfy/runtime/update", async (c) =>
    c.json(await installAction("update"), 202),
  );
  app.post("/api/comfy/runtime/repair", async (c) =>
    c.json(await installAction("repair"), 202),
  );

  const forceParameter = async (request: Request): Promise<boolean> => {
    const body = await parseJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RuntimeRequestError(
        "Runtime action body must be a JSON object.",
        400,
      );
    }
    const force = (body as Record<string, unknown>).force;
    if (force !== undefined && typeof force !== "boolean") {
      throw new RuntimeRequestError(
        "`force` must be a boolean.",
        400,
      );
    }
    return force === true;
  };

  app.post("/api/comfy/runtime/start", async (c) => {
    assertRuntimeControlAvailable("install");
    const current = (await services.runtimeController.status()).state;
    if (current.mode !== "managed") {
      throw new RuntimeRequestError(
        "The app cannot start an external ComfyUI process.",
        409,
      );
    }
    if (!current.activeBundleId) {
      throw new RuntimeRequestError(
        "Install the managed ComfyUI runtime before starting it.",
        409,
      );
    }
    if (current.process && current.status !== "ready") {
      throw new RuntimeRequestError(
        "A managed ComfyUI process is already running but is not ready. Stop or restart it first.",
        409,
      );
    }
    let state: ManagedRuntimeState;
    try {
      state = await services.runtimeController.start();
    } catch {
      throw new RuntimeRequestError(
        "Managed ComfyUI could not be started. Check the runtime logs.",
        409,
      );
    }
    await services.syncGateway(state);
    return c.json({ runtime: await runtimeResponse() });
  });

  app.post("/api/comfy/runtime/stop", async (c) => {
    assertRuntimeControlAvailable("stop");
    if (
      (await services.runtimeController.status()).state.mode !==
      "managed"
    ) {
      throw new RuntimeRequestError(
        "The app cannot stop an external ComfyUI process.",
        409,
      );
    }
    const force = await forceParameter(c.req.raw);
    const state = await services.runtimeController.stop({ force });
    await services.syncGateway(state);
    return c.json({ runtime: await runtimeResponse() });
  });

  app.post("/api/comfy/runtime/restart", async (c) => {
    assertRuntimeControlAvailable("restart");
    if (
      (await services.runtimeController.status()).state.mode !==
      "managed"
    ) {
      throw new RuntimeRequestError(
        "The app cannot restart an external ComfyUI process.",
        409,
      );
    }
    const force = await forceParameter(c.req.raw);
    const state = await services.runtimeController.restart({ force });
    await services.syncGateway(state);
    return c.json({ runtime: await runtimeResponse() });
  });

  const runtimeLogEntry = (
    sessionId: string,
    id: string | number,
    line: string,
  ) => {
    const matched =
      /^(\S+)\s+\[(stdout|stderr|supervisor)\]\s?(.*)$/.exec(line);
    return {
      id,
      timestamp: matched?.[1] ?? "",
      stream:
        matched?.[2] === "stderr"
          ? ("stderr" as const)
          : matched?.[2] === "supervisor"
            ? ("system" as const)
            : ("stdout" as const),
      message: matched?.[3] ?? line,
      sessionId,
    };
  };

  app.get("/api/comfy/runtime/logs", async (c) => {
    if (
      (await services.runtimeController.status()).state.mode ===
      "external"
    ) {
      return c.json({
        entries: [],
        reason: "Managed runtime logs are unavailable in external mode.",
      });
    }
    const limit = numberParameter(c.req.query("limit"), 500, 1, 2_000);
    const session = services.repository.latestRuntimeSession();
    if (!session) {
      return c.json({ entries: [] });
    }
    const content = await services.runtimeController.readLogs(
      session.id,
      Math.min(2 * 1024 * 1024, Math.max(64 * 1024, limit * 2_048)),
    );
    const lines = content.split(/\r?\n/).filter(Boolean).slice(-limit);
    return c.json({
      entries: lines.map((line, index) =>
        runtimeLogEntry(
          session.id,
          `${session.id}:${index}`,
          line,
        ),
      ),
    });
  });

  app.get("/api/comfy/runtime/logs/events", async (c) => {
    if (
      (await services.runtimeController.status()).state.mode ===
      "external"
    ) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({
            reason: "Managed runtime logs are unavailable in external mode.",
          }),
        });
      });
    }
    const requestedAfter = numberParameter(
      c.req.query("cursor") ?? c.req.header("Last-Event-ID"),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const after = Math.min(
      requestedAfter,
      services.runtimeLogs.latestCursor,
    );
    return streamSSE(c, async (stream) => {
      let closed = false;
      let cursor = after;
      const pending: Array<{
        cursor: number;
        sessionId: string;
        source: "stdout" | "stderr" | "supervisor";
        line: string;
        createdAt: string;
      }> = [];
      let wake: (() => void) | null = null;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const subscription = services.runtimeController.tailLogs((event) => {
        if (event.cursor <= cursor) return;
        pending.push(event);
        wake?.();
        wake = null;
      });
      try {
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({ after: cursor }),
        });
        while (!closed) {
          while (pending.length > 0) {
            const event = pending.shift()!;
            cursor = event.cursor;
            const entry = {
              id: event.cursor,
              timestamp: event.createdAt,
              stream:
                event.source === "supervisor"
                  ? ("system" as const)
                  : event.source,
              message: event.line,
              sessionId: event.sessionId,
            };
            await stream.writeSSE({
              id: String(event.cursor),
              event: "log",
              data: JSON.stringify({ entry }),
            });
          }
          const signal = new Promise<void>((resolve) => {
            wake = resolve;
          });
          await Promise.race([signal, stream.sleep(15_000)]);
          if (!closed && pending.length === 0) {
            await stream.writeSSE({
              event: "ping",
              data: new Date().toISOString(),
            });
          }
        }
      } finally {
        subscription.close();
      }
    });
  });

  app.get("/api/app/instance", (c) => {
    const portable = services.portableApp;
    if (
      !portable ||
      !tokensMatch(
        portable.instanceToken,
        c.req.header("X-Anima-Instance-Token"),
      )
    ) {
      return c.json({ message: "Instance token is invalid." }, 404);
    }
    return c.json({ ok: true, id: portable.id, port: portable.port() });
  });

  app.get("/api/app/info", (c) => {
    const portable = services.portableApp;
    if (!portable) {
      return c.json({
        id: "anima-studio",
        version: "development",
        port: services.config.port,
        dataPath: services.config.dataDir,
        repositoryUrl: "https://github.com/cstria0106/anima-studio",
        license: { name: "MIT", url: "/api/app/licenses" },
      });
    }
    return c.json({
      id: portable.id,
      version: portable.version,
      port: portable.port(),
      dataPath: portable.dataDir,
      repositoryUrl: portable.repositoryUrl,
      license: { name: "MIT", url: "/api/app/licenses" },
      thirdPartyLicensesUrl: "/api/app/licenses",
    });
  });

  app.get("/api/app/update", async (c) => {
    const portable = services.portableApp;
    if (!portable) {
      return c.json({
        currentVersion: "development",
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        checkedAt: null,
      });
    }
    return c.json(
      await portable.updates.check(c.req.query("refresh") === "true"),
    );
  });

  app.get("/api/app/licenses", (c) => {
    const notices = services.portableApp?.thirdPartyNotices ??
      "Third-party notices are generated for packaged releases.";
    return c.text(
      MIT_LICENSE + "\n\n" + notices,
      200,
      { "Content-Type": "text/plain; charset=utf-8" },
    );
  });

  app.get("/api/health", async (c) => {
    const comfyConnected = await services.comfy.health();
    const queue = comfyConnected
      ? await services.comfy.getQueue().catch(() => null)
      : null;
    services.database.sqlite.query("SELECT 1").get();
    return c.json({
      ok: true,
      database: { connected: true },
      comfy: {
        connected: comfyConnected,
        url: services.comfy.baseUrl,
      },
      progress: {
        websocketConnected: services.tracker.connected,
      },
      queue: {
        running: queue?.queue_running.length ?? 0,
        pending: queue?.queue_pending.length ?? 0,
      },
      now: new Date().toISOString(),
    });
  });

  app.get("/api/capabilities", async (c) =>
    c.json(await services.capabilities.report()),
  );

  app.get("/api/operations", (c) => {
    const limit = numberParameter(c.req.query("limit"), 30, 1, 100);
    return c.json({ operations: services.operations.list(limit) });
  });

  app.get("/api/operations/:id", (c) => {
    try {
      return c.json({
        operation: services.operations.get(c.req.param("id")),
      });
    } catch {
      throw new JobSubmissionError("Operation not found.", 404);
    }
  });

  app.get("/api/operations/:id/events", (c) => {
    const operationId = c.req.param("id");
    try {
      services.operations.get(operationId);
    } catch {
      throw new JobSubmissionError("Operation not found.", 404);
    }
    const after = numberParameter(
      c.req.query("after") ?? c.req.header("Last-Event-ID"),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );

    return streamSSE(c, async (stream) => {
      let closed = false;
      let cursor = after;
      const pending: ReturnType<typeof services.operations.events> = [];
      const queuedIds = new Set<number>();
      let wake: (() => void) | null = null;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      const push = (event: (typeof pending)[number]) => {
        if (event.id <= cursor || queuedIds.has(event.id)) return;
        pending.push(event);
        queuedIds.add(event.id);
        wake?.();
        wake = null;
      };
      const unsubscribe = services.operations.broker.subscribe(
        operationId,
        push,
      );

      try {
        for (const event of services.operations.events(
          operationId,
          cursor,
        )) {
          push(event);
        }
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({ operationId, after: cursor }),
        });
        while (!closed) {
          while (pending.length > 0) {
            const event = pending.shift()!;
            queuedIds.delete(event.id);
            cursor = event.id;
            const status = services.operations.get(operationId).status;
            await stream.writeSSE({
              id: String(event.id),
              event: "operation",
              data: JSON.stringify({ ...event, status }),
            });
            if (
              status === "completed" ||
              status === "failed" ||
              status === "cancelled"
            ) {
              return;
            }
          }

          const status = services.operations.get(operationId).status;
          if (
            status === "completed" ||
            status === "failed" ||
            status === "cancelled"
          ) {
            return;
          }
          const signal = new Promise<void>((resolve) => {
            wake = resolve;
          });
          await Promise.race([signal, stream.sleep(15_000)]);
          if (!closed && pending.length === 0) {
            await stream.writeSSE({
              event: "ping",
              data: new Date().toISOString(),
            });
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  const civitaiProvider = async () => {
    const base = await services.modelLibrary.providerStatus();
    const state = (await services.runtimeController.status()).state;
    const reason = modelDownloadUnavailableReason(state);
    return {
      ...base,
      available: reason === null,
      managedDownloads: reason === null,
      ...(reason ? { reason } : {}),
    };
  };

  const assertCivitaiDownloadsAvailable = async () => {
    const provider = await civitaiProvider();
    if (!provider.available) {
      throw new CivitaiError(
        "DOWNLOAD_FAILED",
        provider.reason ??
          "Managed model downloads are not available.",
        409,
      );
    }
  };

  const huggingFaceProvider = async () => {
    const state = (await services.runtimeController.status()).state;
    const managedDownloads = state.mode === "managed";
    const reason = managedDownloads
      ? undefined
      : "Hugging Face 모델 자동 설치는 관리형 ComfyUI 모드에서만 사용할 수 있습니다.";
    return services.huggingFaceLibrary.providerStatus(
      managedDownloads,
      reason,
    );
  };

  const assertHuggingFaceDownloadsAvailable = async () => {
    const provider = await huggingFaceProvider();
    if (!provider.available || !provider.managedDownloads) {
      throw new HuggingFaceError(
        "DOWNLOAD_FAILED",
        provider.reason ??
          "Hugging Face 모델 자동 설치를 사용할 수 없습니다.",
        409,
      );
    }
  };

  app.get("/api/download-providers/civitai", async (c) =>
    c.json({ provider: await civitaiProvider() }),
  );

  app.put("/api/download-providers/civitai/token", async (c) => {
    const body = await parseJson(c.req.raw);
    const token =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).token
        : null;
    if (typeof token !== "string") {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "Request body must contain a Civitai token.",
        400,
      );
    }
    await services.modelLibrary.setToken(token);
    return c.json({ provider: await civitaiProvider() });
  });

  app.delete("/api/download-providers/civitai/token", async (c) => {
    await services.modelLibrary.deleteToken();
    return c.json({ provider: await civitaiProvider() });
  });

  app.post("/api/model-installations/civitai/inspect", async (c) => {
    const parsed = civitaiInspectRequestSchema.safeParse(
      await parseJson(c.req.raw),
    );
    if (!parsed.success) {
      throw new CivitaiError(
        "INVALID_URL",
        "Request body must contain a supported Civitai model URL.",
        400,
      );
    }
    return c.json({
      model: services.modelDownloads.decorateCivitai(
        await services.modelLibrary.inspect(parsed.data.url),
      ),
    });
  });

  app.get("/api/download-providers/huggingface/anima", async (c) => {
    return c.json({
      provider: await huggingFaceProvider(),
      catalog: services.modelDownloads.decorateAnima(
        await services.huggingFaceLibrary.catalog(),
      ),
    });
  });

  app.post("/api/model-installations/anima", async (c) => {
    await assertHuggingFaceDownloadsAvailable();
    const parsed = huggingFaceAnimaDownloadCreateSchema.safeParse(
      await parseJson(c.req.raw),
    );
    if (!parsed.success) {
      throw new HuggingFaceError(
        "INVALID_FILE",
        "Anima 모델 설치 요청이 올바르지 않습니다.",
        400,
      );
    }
    const current = services.modelDownloads.current(
      "huggingface",
      "circlestone-labs/Anima",
      parsed.data.revision,
      parsed.data.path,
    );
    if (current) return c.json(current, 200);
    const result = await services.huggingFaceLibrary.install(
      parsed.data,
    );
    const primary =
      result.downloads.find(
        (download) => download.providerFileId === parsed.data.path,
      ) ?? result.downloads[0];
    if (!primary) {
      throw new HuggingFaceError(
        "DOWNLOAD_FAILED",
        "Anima 모델 설치 작업을 만들지 못했습니다.",
        500,
      );
    }
    const task = services.modelDownloads.track(
      result.downloads,
      primary.id,
    );
    return c.json(task, 202);
  });

  app.post("/api/model-installations/civitai", async (c) => {
    await assertCivitaiDownloadsAvailable();
    const parsed = modelDownloadCreateSchema.safeParse(
      await parseJson(c.req.raw),
    );
    if (!parsed.success) {
      throw new CivitaiError(
        "INVALID_MODEL",
        "Model download settings are invalid.",
        400,
      );
    }
    const current = services.modelDownloads.current(
      "civitai",
      String(parsed.data.modelId),
      String(parsed.data.modelVersionId),
      parsed.data.fileId === undefined
        ? null
        : String(parsed.data.fileId),
    );
    if (current) return c.json(current, 200);
    const download = await services.modelLibrary.create(parsed.data);
    const task = services.modelDownloads.track([download], download.id);
    return c.json(task, 202);
  });

  app.get("/api/model-installations/civitai/loras", (c) =>
    c.json({
      installations: services.modelDownloads.listInstallations(
        "civitai",
        "loras",
      ),
    }),
  );

  app.delete("/api/model-installations/:id", async (c) => {
    const removed = await services.modelDownloads.remove(
      c.req.param("id"),
    );
    return c.json({ installationId: removed.id });
  });

  app.get("/api/model-installations/:id/events", (c) => {
    const installationId = c.req.param("id");
    services.modelDownloads.getTask(installationId);
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });
      let eventId = 0;
      while (!closed) {
        const task = services.modelDownloads.getTask(installationId);
        eventId += 1;
        await stream.writeSSE({
          id: String(eventId),
          event: "installation",
          data: JSON.stringify(task),
        });
        if (task.status !== "installing") return;
        await stream.sleep(350);
      }
    });
  });

  app.get("/api/storage", async (c) =>
    c.json({ storage: await services.storageInventory.inventory() }),
  );

  app.post("/api/storage/cleanup", async (c) =>
    c.json({
      cleanup: await services.storageInventory.cleanup(
        await parseJson(c.req.raw),
      ),
    }),
  );

  app.get("/api/library/folders", (c) =>
    c.json({ folders: services.library.folders() }),
  );

  app.post("/api/library/folders", async (c) =>
    c.json(
      { folder: services.library.createFolder(await parseJson(c.req.raw)) },
      201,
    ),
  );

  app.patch("/api/library/folders/:id", async (c) =>
    c.json({
      folder: services.library.updateFolder(
        c.req.param("id"),
        await parseJson(c.req.raw),
      ),
    }),
  );

  app.delete("/api/library/folders/:id", (c) =>
    c.json({ result: services.library.deleteFolder(c.req.param("id")) }),
  );

  app.get("/api/library/images", (c) =>
    c.json(
      services.library.images({
        ...(c.req.query("folder") ? { folder: c.req.query("folder")! } : {}),
        ...(c.req.query("q") ? { query: c.req.query("q")! } : {}),
        ...(c.req.query("cursor") ? { cursor: c.req.query("cursor")! } : {}),
        limit: numberParameter(c.req.query("limit"), 40, 1, 100),
      }),
    ),
  );

  app.get("/api/library/images/download", async (c) => {
    const files = services.library.downloadImages(c.req.queries("id") ?? []);
    if (files.length === 1) {
      const file = files[0]!;
      const bytes = await file.load();
      return new Response(bytes.slice().buffer, {
        headers: {
          "content-type": file.mimeType,
          "content-length": String(bytes.byteLength),
          "content-disposition": attachmentDisposition(file.filename),
        },
      });
    }

    const names = uniqueZipNames(files.map((file) => file.filename));
    const timestamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    const filename = `anima-studio-images-${timestamp}.zip`;
    return new Response(
      createZipStream(
        files.map((file, index) => ({ name: names[index]!, load: file.load })),
      ),
      {
        headers: {
          "content-type": "application/zip",
          "content-disposition": attachmentDisposition(filename),
        },
      },
    );
  });

  app.patch("/api/library/images/folder", async (c) =>
    c.json({
      result: services.library.moveImages(await parseJson(c.req.raw)),
    }),
  );

  app.post("/api/library/images/delete", async (c) =>
    c.json({
      result: await services.library.deleteImages(await parseJson(c.req.raw)),
    }),
  );

  app.get("/api/options", async (c) => {
    if (!services.gateway.available) {
      return c.json({
        diffusionModels: [],
        clips: [],
        vaes: [],
        loras: [],
        samplers: [],
        schedulers: [],
        imagePresets: [...CURATED_IMAGE_PRESETS],
        upscaleMethods: [
          "nearest-exact",
          "bilinear",
          "area",
          "bicubic",
          "bislerp",
        ],
      });
    }
    const options = await services.capabilities.options();
    const civitaiLoras = services.modelDownloads.listInstallations(
      "civitai",
      "loras",
    );
    const enrichedLoras = await services.modelLibrary
      .getLoraMetadata(options.loras, civitaiLoras)
      .catch(() => null);
    return c.json({
      ...options,
      loras: (enrichedLoras ?? options.loras).map((lora) =>
        typeof lora === "string" || !lora.thumbnailUrl
          ? lora
          : {
              ...lora,
              thumbnailUrl: `/api/lora-thumbnail?lora=${encodeURIComponent(lora.value)}`,
            },
      ),
      upscaleMethods: [
        "nearest-exact",
        "bilinear",
        "area",
        "bicubic",
        "bislerp",
      ],
    });
  });

  app.get("/api/lora-thumbnail", async (c) => {
    const lora = c.req.query("lora") ?? "";
    if (!lora || lora.length > 1_024) {
      throw new JobSubmissionError("LoRA thumbnail request is invalid.", 400);
    }
    const installed = (await services.capabilities.options()).loras;
    if (!installed.includes(lora)) {
      throw new JobSubmissionError("LoRA thumbnail was not found.", 404);
    }
    const thumbnail = await services.modelLibrary.downloadLoraThumbnail(
      lora,
      services.modelDownloads.listInstallations("civitai", "loras"),
    );
    if (!thumbnail?.contentType?.startsWith("image/")) {
      throw new JobSubmissionError("LoRA thumbnail was not found.", 404);
    }
    return new Response(thumbnail.bytes.slice().buffer, {
      headers: {
        "content-type": thumbnail.contentType,
        "content-length": String(thumbnail.bytes.byteLength),
        "cache-control": "private, max-age=3600",
      },
    });
  });

  app.get("/api/tags", (c) => {
    const query = (c.req.query("q") ?? "").slice(0, 200);
    const limit = numberParameter(c.req.query("limit"), 20, 1, 50);
    const context = tagContextParameter(
      c.req.query("context"),
      c.req.query("related"),
    );
    const metadata = services.repository.tagIndexMetadata();
    return c.json({
      tags: services.repository.searchTags(query, limit, context),
      ...(context.length > 0
        ? { related: services.repository.relatedTags(context, "", limit) }
        : {}),
      meta: {
        source: metadata?.source ?? "fallback",
        query,
        context,
        cooccurrenceEnabled:
          context.length > 0 && (metadata?.cooccurrenceCount ?? 0) > 0,
      },
    });
  });

  app.post(
    "/api/assets",
    bodyLimit({
      maxSize: services.config.maxUploadBatchBytes,
      onError: (c) =>
        c.json(
          {
            message: `Upload request exceeds ${services.config.maxUploadBatchBytes} bytes.`,
            error: {
              code: "FILE_ERROR",
              message: `Upload request exceeds ${services.config.maxUploadBatchBytes} bytes.`,
            },
          },
          413,
        ),
    }),
    async (c) => {
    const form = await c.req.raw.formData();
    const candidates = [
      ...form.getAll("files"),
      ...form.getAll("file"),
    ].filter((value): value is File => value instanceof File);
    if (candidates.length === 0) {
      throw new JobSubmissionError(
        "Upload one or more images using the `files` form field.",
        400,
      );
    }
    if (candidates.length > 32) {
      throw new JobSubmissionError(
        "At most 32 reference images can be uploaded at once.",
        413,
      );
    }
    const aggregateSize = candidates.reduce((sum, file) => sum + file.size, 0);
    if (aggregateSize > services.config.maxUploadBatchBytes) {
      throw new JobSubmissionError(
        `Combined image size exceeds ${services.config.maxUploadBatchBytes} bytes.`,
        413,
      );
    }
    const assets = [];
    for (const file of candidates) {
      assets.push(await services.storage.storeAsset(file));
    }
    return c.json({ assets }, 201);
    },
  );

  app.get("/api/assets/:id", async (c) => {
    const row = services.repository.findAsset(c.req.param("id"));
    if (!row) throw new JobSubmissionError("Asset not found.", 404);
    const file = await services.storage.readAsset(row);
    return new Response(file.bytes.slice().buffer, {
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": inlineDisposition(file.filename),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  });

  app.get("/api/outputs/:id", async (c) => {
    const row = services.repository.findOutput(c.req.param("id"));
    if (!row) throw new JobSubmissionError("Output not found.", 404);
    const file = await services.storage.readOutput(row);
    return new Response(file.bytes.slice().buffer, {
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": inlineDisposition(file.filename),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  });

  app.post("/api/jobs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new JobSubmissionError("Request body must be valid JSON.", 400);
    }
    if (!body || typeof body !== "object" || !("config" in body)) {
      throw new JobSubmissionError(
        "Request body must contain a `config` object.",
        400,
      );
    }
    const job = await services.jobs.create(
      (body as { config: unknown }).config,
    );
    return c.json({ job }, 202);
  });

  app.get("/api/jobs", (c) => {
    const requestedStatus = c.req.query("status");
    const status =
      requestedStatus &&
      services.jobs
        .statuses()
        .includes(requestedStatus as JobStatus)
        ? (requestedStatus as JobStatus)
        : undefined;
    if (requestedStatus && !status) {
      throw new JobSubmissionError(
        `Unknown job status: ${requestedStatus}`,
        400,
      );
    }
    const result = services.jobs.list({
      ...(status ? { status } : {}),
      ...(c.req.query("model") ? { model: c.req.query("model")! } : {}),
      ...(c.req.query("q") ? { query: c.req.query("q")! } : {}),
      ...(c.req.query("before") ?? c.req.query("cursor")
        ? { before: (c.req.query("before") ?? c.req.query("cursor"))! }
        : {}),
      limit: numberParameter(c.req.query("limit"), 30, 1, 100),
    });
    return c.json(result);
  });

  app.get("/api/jobs/:id", (c) => {
    return c.json({ job: services.jobs.get(c.req.param("id")) });
  });

  app.delete("/api/jobs/:id", async (c) => {
    await services.jobs.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/api/jobs/:id/preview", async (c) => {
    const jobId = c.req.param("id");
    services.jobs.get(jobId);
    try {
      const file = await services.storage.readPreview(jobId);
      return new Response(file.bytes.slice().buffer, {
        headers: {
          "content-type": file.mimeType,
          "content-length": String(file.bytes.byteLength),
          "content-disposition": inlineDisposition(file.filename),
          "cache-control": "private, no-store, max-age=0",
        },
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "ENOENT") {
        throw new JobSubmissionError(
          "No denoise preview is available for this job yet.",
          404,
        );
      }
      throw error;
    }
  });

  app.post("/api/jobs/:id/upscale", async (c) => {
    const text = await c.req.text();
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new JobSubmissionError(
          "Request body must be valid JSON.",
          400,
        );
      }
    }
    const job = await services.jobs.upscale(c.req.param("id"), body);
    return c.json({ job }, 202);
  });

  app.post("/api/jobs/:id/cancel", async (c) => {
    return c.json({ job: await services.jobs.cancel(c.req.param("id")) });
  });

  app.get("/api/jobs/:id/events", (c) => {
    const jobId = c.req.param("id");
    services.jobs.get(jobId);
    const headerCursor = c.req.header("Last-Event-ID");
    const after = numberParameter(
      c.req.query("after") ?? headerCursor,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );

    return streamSSE(c, async (stream) => {
      let closed = false;
      let cursor = after;
      const pending: ReturnType<typeof services.events.list> = [];
      const queuedIds = new Set<number>();
      let wake: (() => void) | null = null;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      const push = (event: (typeof pending)[number]) => {
        if (event.id <= cursor) return;
        if (queuedIds.has(event.id)) return;
        pending.push(event);
        queuedIds.add(event.id);
        wake?.();
        wake = null;
      };
      const unsubscribe = services.events.broker.subscribe(jobId, push);

      try {
        for (const event of services.events.list(jobId, cursor)) push(event);
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({ jobId, after: cursor }),
        });

        while (!closed) {
          while (pending.length > 0) {
            const event = pending.shift()!;
            queuedIds.delete(event.id);
            cursor = event.id;
            const status =
              event.phase === "completed" ||
              event.phase === "failed" ||
              event.phase === "cancelled"
                ? event.phase
                : services.jobs.get(jobId).status;
            await stream.writeSSE({
              id: String(event.id),
              event: "job",
              data: JSON.stringify({ ...event, status }),
            });
            if (
              event.phase === "completed" ||
              event.phase === "failed" ||
              event.phase === "cancelled"
            ) {
              return;
            }
          }

          const currentJob = services.jobs.get(jobId);
          if (
            currentJob.status === "completed" ||
            currentJob.status === "failed" ||
            currentJob.status === "cancelled"
          ) {
            return;
          }

          const signal = new Promise<void>((resolve) => {
            wake = resolve;
          });
          const ping = stream.sleep(15_000);
          await Promise.race([signal, ping]);
          if (!closed && pending.length === 0) {
            await stream.writeSSE({
              event: "ping",
              data: new Date().toISOString(),
            });
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.notFound((c) => {
    if (!c.req.path.startsWith("/api/")) {
      const response = services.portableApp?.staticSite.response(c.req.path);
      if (response) return response;
    }
    return c.json(
      {
        message: "API route not found.",
        error: {
          code: "NOT_FOUND",
          message: "API route not found.",
        },
      },
      404,
    );
  });

  return app;
}
