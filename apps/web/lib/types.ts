export type {
  ManagedModelInstallationDto as ManagedModelInstallation,
} from "@anima/shared";

export type JobStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ReferenceAsset {
  id: string;
  sha256?: string;
  name: string;
  url: string;
  width?: number;
  height?: number;
  size?: number;
  status?: "uploading" | "ready" | "error";
  error?: string;
}

export interface LoraSelection {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  modelStrength: number;
  clipStrength: number;
  triggerWords: string[];
  useTriggerWords: boolean;
  thumbnailUrl?: string;
}

export interface GenerationDraft {
  referenceAssets: ReferenceAsset[];
  prompts: {
    basePositive: string;
    positive: string;
    natural: string;
    baseNegative: string;
    negative: string;
  };
  models: {
    diffusion: string;
    clip: string;
    vae: string;
  };
  loras: LoraSelection[];
  sampling: {
    seedMode: "random" | "fixed";
    seed: number;
    sampler: string;
    scheduler: string;
    steps: number;
    cfg: number;
    denoise: number;
    width: number;
    height: number;
    batchSize: number;
    cfgStart: number;
    cfgEnd: number;
  };
  instantLora: {
    modelStrength: number;
    clipStrength: number;
    trainingSteps: number;
    learningRate: number;
    dimension: number;
    alpha: number;
    cache: boolean;
    cacheTextEncoderOutputs: boolean;
    gradientCheckpointing: boolean;
    forceRetrain: boolean;
    seed: number;
    batchSize: number;
    resolution: string;
  };
  tagging: {
    threshold: number;
    characterThreshold: number;
    prependTags: string;
    appendTags: string;
    excludeTags: string;
    replaceTags: string;
    removeUnderscore: boolean;
  };
  upscale: {
    enabled: boolean;
    method: string;
    scale: number;
    steps: number;
    denoise: number;
  };
}

export type SettingsSection = "overview" | "runtime" | "storage";

export interface UiPreferences {
  draft?: GenerationDraft;
  blurSensitive?: boolean;
  completionNotificationsEnabled?: boolean;
  settingsSection?: SettingsSection;
}

export const DEFAULT_DRAFT: GenerationDraft = {
  referenceAssets: [],
  prompts: {
    basePositive:
      "newest, masterpiece, very aesthetic, score_7, best quality",
    positive: "",
    natural: "",
    baseNegative:
      "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration",
    negative: "",
  },
  models: {
    diffusion: "",
    clip: "",
    vae: "",
  },
  loras: [],
  sampling: {
    seedMode: "random",
    seed: 42,
    sampler: "er_sde",
    scheduler: "sgm_uniform",
    steps: 30,
    cfg: 5,
    denoise: 1,
    width: 1024,
    height: 1024,
    batchSize: 1,
    cfgStart: 0,
    cfgEnd: 1,
  },
  instantLora: {
    modelStrength: 0.8,
    clipStrength: 0.8,
    trainingSteps: 200,
    learningRate: 0.001,
    dimension: 16,
    alpha: 1,
    cache: true,
    cacheTextEncoderOutputs: true,
    gradientCheckpointing: true,
    forceRetrain: false,
    seed: 42,
    batchSize: 0,
    resolution: "",
  },
  tagging: {
    threshold: 0.35,
    characterThreshold: 0.7,
    prependTags: ", 3d, koikatsu (medium)",
    appendTags: "vrcg",
    excludeTags: "",
    replaceTags: "",
    removeUnderscore: true,
  },
  upscale: {
    enabled: false,
    method: "bilinear",
    scale: 1.5,
    steps: 30,
    denoise: 0.8,
  },
};

export interface ModelOption {
  name: string;
  value: string;
}

export interface LoraOption extends ModelOption {
  triggerWords?: string[];
  thumbnailUrl?: string;
}

export interface StudioOptions {
  diffusionModels: ModelOption[];
  clips: ModelOption[];
  vaes: ModelOption[];
  loras: LoraOption[];
  samplers: string[];
  schedulers: string[];
  upscaleMethods: string[];
  presets: Array<{ label: string; width: number; height: number }>;
}

export const EMPTY_OPTIONS: StudioOptions = {
  diffusionModels: [],
  clips: [],
  vaes: [],
  loras: [],
  samplers: [],
  schedulers: [],
  upscaleMethods: [],
  presets: [],
};

export type StorageItemKind =
  | "asset"
  | "output"
  | "instant_lora"
  | "model_download";

export interface StorageDependency {
  kind: "job";
  id: string;
  label: string;
}

export interface StorageItem {
  kind: StorageItemKind;
  id: string;
  name: string;
  byteSize: number;
  createdAt: string | null;
  dependencies: StorageDependency[];
  cleanupEligible: boolean;
  cleanupReason: string | null;
}

export interface StorageInventory {
  totalBytes: number;
  categories: Array<{
    kind: StorageItemKind;
    byteSize: number;
    itemCount: number;
  }>;
  items: StorageItem[];
}

export interface StorageCleanupTarget {
  kind: StorageItemKind;
  id: string;
}

export interface StorageCleanupResult {
  dryRun: boolean;
  reclaimedBytes: number;
  results: Array<{
    kind: StorageItemKind;
    id: string;
    eligible: boolean;
    deleted: boolean;
    byteSize: number;
    reason: string | null;
    dependencies: StorageDependency[];
  }>;
}

export interface HealthResponse {
  ok: boolean;
  app?: boolean;
  database?: boolean;
  comfyui?: boolean;
  comfyUrl?: string;
  queue?: { running: number; pending: number };
  message?: string;
  version?: string;
}

export interface CapabilityIssue {
  classType?: string;
  id?: string;
  label?: string;
  kind?: string;
  packageName?: string;
  installUrl?: string;
  reason?: string;
}

export interface CapabilitiesResponse {
  ready: boolean;
  comfyUrl?: string;
  requiredNodes?: string[];
  missingNodes: CapabilityIssue[];
  optional?: CapabilityIssue[];
  incompatibleNodes?: CapabilityIssue[];
  warnings?: string[];
  checkedAt?: string;
}

export interface TagSuggestion {
  tag: string;
  insertText?: string;
  category?: string;
  count?: number;
  description?: string;
  aliases?: string[];
  cooccurrenceCount?: number;
  matchedContext?: string[];
}

export interface JobOutput {
  id: string;
  kind: "base" | "upscale" | string;
  url?: string;
  width?: number;
  height?: number;
}

export interface JobPreview {
  url: string;
  mimeType?: string;
  revision?: string | number;
  step?: number;
  total?: number;
  updatedAt?: string;
}

export interface JobEvent {
  id?: string | number;
  type?: string;
  status?: JobStatus;
  stage?: string;
  phase?: string;
  message?: string;
  progress?: number;
  value?: number;
  max?: number;
  current?: number | null;
  total?: number | null;
  createdAt?: string;
  output?: JobOutput;
  preview?: JobPreview | string;
  previewUrl?: string;
  error?: string;
}

export interface StudioJob {
  id: string;
  parentJobId?: string;
  sourceOutputId?: string;
  kind?: "generation" | "upscale" | string;
  status: JobStatus;
  stage?: string;
  progress?: number;
  queuePosition?: number;
  promptId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  settings: GenerationDraft;
  outputs: JobOutput[];
  preview?: JobPreview;
  autoTags?: string[];
  elapsedMs?: number;
}

export interface JobListResponse {
  jobs: StudioJob[];
  nextCursor?: string;
}

export type RuntimeMode = "managed" | "external";

export type RuntimeState =
  | "not_installed"
  | "installing"
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "updating"
  | "repairing"
  | "failed";

export interface RuntimeHardware {
  platform: string;
  architecture: string;
  supported: boolean;
  gpuName: string | null;
  driverVersion: string | null;
  vramBytes: number | null;
  freeDiskBytes: number | null;
  warnings: string[];
}

export interface ComfyRuntime {
  mode: RuntimeMode;
  state: RuntimeState;
  installed: boolean;
  ready: boolean;
  bundleId: string | null;
  comfyVersion: string | null;
  comfyUrl: string;
  externalUrl: string | null;
  port: number | null;
  pid: number | null;
  startedAt: string | null;
  error: string | null;
  autoStart: boolean;
  stopWithApi: boolean;
  hardware: RuntimeHardware | null;
  activeOperationId: string | null;
}

export interface RuntimeConfigUpdate {
  mode: RuntimeMode;
  externalUrl: string | null;
  autoStart: boolean;
  stopWithApi: boolean;
  port: number | null;
}

export type OperationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface OperationEvent {
  id: number;
  operationId: string;
  phase: string;
  message: string;
  progress: number | null;
  current: number | null;
  total: number | null;
  bytesCompleted: number | null;
  bytesTotal: number | null;
  bytesPerSecond: number | null;
  payload?: unknown;
  createdAt: string;
}

export interface LongOperation {
  id: string;
  kind:
    | "runtime_install"
    | "runtime_update"
    | "runtime_repair"
    | "model_download";
  status: OperationStatus;
  phase: string;
  message: string;
  progress: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  latestEvent?: OperationEvent;
}

export type RuntimeAction =
  | "install"
  | "start"
  | "stop"
  | "restart"
  | "update"
  | "repair";

export interface RuntimeActionResult {
  runtime: ComfyRuntime;
  operation?: LongOperation;
}

export interface RuntimeLogEntry {
  id: string | number;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  level?: "debug" | "info" | "warning" | "error";
  message: string;
}

export interface RuntimeLogsResponse {
  entries: RuntimeLogEntry[];
  nextCursor?: string;
}

export interface CivitaiProviderStatus {
  provider: "civitai";
  available: boolean;
  tokenConfigured: boolean;
  supportedHosts: ["civitai.com", "civitai.red"];
  supportedFormats: [".safetensors"];
  managedDownloads: boolean;
  destinations: Array<{
    id: ModelDestination;
    label: string;
    kind: ModelDestination;
  }>;
  reason?: string;
}

export interface CivitaiFile {
  id: number;
  name: string;
  type: string;
  format: string | null;
  size: string | null;
  precision: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  primary: boolean;
  downloadUrl?: string;
  installationId: string | null;
  installationStatus: ModelInstallationStatus;
  installationProgress: number | null;
}

export interface CivitaiVersion {
  id: number;
  name: string;
  baseModel: string | null;
  createdAt: string | null;
  earlyAccessEndsAt: string | null;
  thumbnailUrl: string | null;
  trainedWords: string[];
  files: CivitaiFile[];
}

export interface CivitaiModelInspection {
  provider: "civitai";
  sourceUrl: string;
  host: "civitai.com" | "civitai.red";
  modelId: number;
  requestedVersionId: number | null;
  name: string;
  type: string;
  creator: string | null;
  description: string | null;
  contentRating: string | null;
  license: Record<string, unknown> | null;
  thumbnailUrl: string | null;
  versions: CivitaiVersion[];
}

export type ModelDestination =
  | "loras"
  | "diffusion_models"
  | "checkpoints"
  | "text_encoders"
  | "vae";

export type ModelInstallationStatus =
  | "not_installed"
  | "installing"
  | "installed";

export interface ModelInstallTask {
  installationId: string;
  status: "installing" | "installed" | "failed";
  progress: number;
  error?: string;
}

export interface CivitaiModelInstallRequest {
  modelId: number;
  modelVersionId: number;
  fileId?: number;
  sourceUrl?: string;
  destinationRootId: Extract<
    ModelDestination,
    "loras" | "diffusion_models" | "checkpoints"
  >;
  relativeDir?: string;
}

export type HuggingFaceAnimaFileKind =
  | "diffusion_model"
  | "text_encoder"
  | "vae";

export interface HuggingFaceAnimaFile {
  path: string;
  filename: string;
  kind: HuggingFaceAnimaFileKind;
  destinationRootId: Extract<
    ModelDestination,
    "diffusion_models" | "text_encoders" | "vae"
  >;
  sizeBytes: number;
  sha256: string;
  recommended: boolean;
  experimental: boolean;
  installationId: string | null;
  installationStatus: ModelInstallationStatus;
  installationProgress: number | null;
}

export interface HuggingFaceAnimaCatalog {
  provider: "huggingface";
  repository: "circlestone-labs/Anima";
  sourceUrl: string;
  revision: string;
  lastModified: string | null;
  license: string;
  licenseUrl: string;
  thumbnailUrl: string | null;
  files: HuggingFaceAnimaFile[];
}

export interface HuggingFaceAnimaProviderStatus {
  provider: "huggingface";
  available: boolean;
  repository: "circlestone-labs/Anima";
  managedDownloads: boolean;
  supportedFormats: [".safetensors"];
  destinations: Array<{
    id: ModelDestination;
    label: string;
    kind: ModelDestination;
  }>;
  reason?: string;
}

export interface HuggingFaceAnimaProviderResponse {
  provider: HuggingFaceAnimaProviderStatus;
  catalog: HuggingFaceAnimaCatalog;
}

export interface HuggingFaceAnimaInstallRequest {
  revision: string;
  path: string;
  includeDependencies: boolean;
  acceptedLicense: true;
}
export interface AppInfo {
  id: string;
  version: string;
  port: number;
  dataPath: string;
  repositoryUrl: string;
  license: { name: string; url: string };
  thirdPartyLicensesUrl?: string;
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string | null;
}
