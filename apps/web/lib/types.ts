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

/**
 * A reusable character setup. The API stores a complete draft snapshot so a
 * profile remains reproducible even when defaults change between releases.
 * `representativeOutputId` is deliberately an output id (not a Comfy filename)
 * because app outputs outlive the ComfyUI history.
 */
export interface CharacterProfile {
  id: string;
  name: string;
  description?: string;
  draft: GenerationDraft;
  representativeOutputId?: string;
  representativeUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterProfileInput {
  name: string;
  description?: string;
  draft: GenerationDraft;
}

/**
 * Model packs intentionally contain only the base model selection and ordered
 * LoRA stack. Applying one must never replace prompts, references, or sampling.
 */
export interface ModelPack {
  id: string;
  name: string;
  description?: string;
  models: GenerationDraft["models"];
  loras: LoraSelection[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelPackInput {
  name: string;
  description?: string;
  models: GenerationDraft["models"];
  loras: LoraSelection[];
}

export type PromptSourceKind =
  | "base-positive"
  | "user-positive"
  | "natural"
  | "lora-trigger"
  | "auto-tag"
  | "base-negative"
  | "user-negative";

export interface PromptInspectorSource {
  id: PromptSourceKind;
  label: string;
  tone: "pink" | "violet" | "cyan" | "amber" | "emerald" | "slate" | "red";
  text: string;
  tags: string[];
  runtime?: boolean;
}

export interface PromptConflict {
  left: string;
  right: string;
  reason: string;
}

export interface VariationCombination {
  id: string;
  label: string;
  positive: string;
  seedMode: "random" | "fixed";
  seed: number;
}

export interface VariationMatrixRequest {
  baseDraft: GenerationDraft;
  combinations: VariationCombination[];
}

export interface VariationMatrixResponse {
  jobs: StudioJob[];
}

export interface ComparisonItem {
  id: string;
  jobId: string;
  label: string;
  url: string;
  width?: number;
  height?: number;
  seed?: number;
  kind?: string;
}

export const DEFAULT_DRAFT: GenerationDraft = {
  referenceAssets: [],
  prompts: {
    basePositive:
      "newest, masterpiece, very aesthetic, score_7, best quality",
    positive: "",
    natural: "",
    baseNegative:
      "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, signature, deviantart username, deviantart",
    negative:
      "3d, koikatsu \\(medium\\)\nthick outlines, black outline\nshort sidetail, twintails, ",
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
    width: 704,
    height: 1408,
    batchSize: 1,
    cfgStart: 0,
    cfgEnd: 1,
  },
  instantLora: {
    modelStrength: 0.7,
    clipStrength: 0.7,
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
    denoise: 0.7,
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

export type OnboardingStepId =
  | "welcome"
  | "runtime"
  | "models"
  | "character"
  | "test_generation";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  complete: boolean;
  blocking: boolean;
  message: string;
  actionHref: string;
}

export interface OnboardingStatus {
  version: 1;
  dismissed: boolean;
  complete: boolean;
  steps: OnboardingStep[];
}

export interface OnboardingUpdate {
  dismissed?: boolean;
  completedSteps?: OnboardingStepId[];
}

export type StorageItemKind =
  | "asset"
  | "output"
  | "preview"
  | "model_download";

export interface StorageDependency {
  kind: "job" | "character_profile" | "model_pack";
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

export interface PortableAsset {
  sha256: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  width: number | null;
  height: number | null;
  dataBase64: string;
}

export interface PortableInstantLora {
  profile: string;
  modelStrength: number;
  clipStrength: number;
  tagging: {
    generalThreshold: number;
    characterThreshold: number;
    prependTags: string;
    appendTags: string;
    excludeTags: string;
    replaceTags: string;
    removeUnderscore: boolean;
  };
  training: {
    steps: number;
    learningRate: number;
    networkDim: number;
    networkAlpha: number;
    resolution: string;
    gradientCheckpointing: boolean;
    cacheLatents: boolean;
    cacheTextEncoderOutputs: boolean;
    seed: number;
    forceRetrain: boolean;
    batchSize: number;
  };
}

export interface PortableCharacterProfile {
  sourceId?: string;
  name: string;
  description: string;
  referenceAssetSha256: string[];
  prompts: GenerationDraft["prompts"];
  instantLora: PortableInstantLora;
  excludedTags: string[];
  cache: {
    state: "empty" | "ready" | "stale";
    cacheKey: string | null;
    referenceFingerprint: string | null;
    loraName: string | null;
    trainedAt: string | null;
    autoTags: string[];
  };
}

export interface PortableModelPack {
  sourceId?: string;
  name: string;
  description: string;
  model: {
    diffusionModel: string;
    clip: string;
    clipType: string;
    vae: string;
    weightDtype: string;
  };
  loras: Array<{
    name: string;
    modelStrength: number;
    clipStrength: number;
    enabled: boolean;
  }>;
}

export interface PortableBundle {
  format: "anima-studio-portable";
  version: 1;
  exportedAt: string;
  assets: PortableAsset[];
  characterProfiles: PortableCharacterProfile[];
  modelPacks: PortableModelPack[];
}

export interface PortableImportIssue {
  kind: "node" | "model" | "asset" | "bundle" | "endpoint";
  id: string;
  label: string;
  package?: string;
  installUrl?: string;
}

export interface PortableImportPreview {
  valid: boolean;
  assetCount: number;
  newAssetCount: number;
  deduplicatedAssetCount: number;
  totalAssetBytes: number;
  characterProfileCount: number;
  modelPackCount: number;
  missing: PortableImportIssue[];
}

export interface PortableImportResult {
  preview: PortableImportPreview;
  characterProfiles: CharacterProfile[];
  modelPacks: ModelPack[];
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
  restartRequired?: boolean;
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
}

export interface CivitaiVersion {
  id: number;
  name: string;
  baseModel: string | null;
  createdAt: string | null;
  earlyAccessEndsAt: string | null;
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

export type ModelDownloadState =
  | "resolving"
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "indexing"
  | "completed"
  | "failed"
  | "cancelled";

export type ModelDestination =
  | "loras"
  | "diffusion_models"
  | "checkpoints"
  | "text_encoders"
  | "vae";

export interface ModelDownload {
  id: string;
  operationId: string;
  state: ModelDownloadState;
  provider: "civitai" | "huggingface";
  providerModelId: string;
  providerVersionId: string;
  providerFileId: string | null;
  modelId: number | null;
  modelVersionId: number | null;
  fileId: number | null;
  modelName: string;
  versionName: string;
  filename: string;
  destinationRootId: ModelDestination;
  relativeDir: string;
  expectedSha256: string | null;
  actualSha256: string | null;
  bytesCompleted: number;
  bytesTotal: number | null;
  bytesPerSecond: number | null;
  triggerWords: string[];
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ModelDownloadCreate {
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

export interface ModelDownloadListResponse {
  downloads: ModelDownload[];
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

export interface HuggingFaceAnimaInstallResult {
  downloads: ModelDownload[];
  alreadyInstalled: string[];
}
