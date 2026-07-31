import { z } from "zod";

export const CURATED_IMAGE_PRESETS = [
  { label: "세로 · 1:2", width: 704, height: 1408 },
  { label: "세로 · 4:7", width: 768, height: 1344 },
  { label: "세로 · 2:3", width: 832, height: 1248 },
  { label: "세로 · 7:9", width: 896, height: 1152 },
  { label: "정사각형 · 1:1", width: 1024, height: 1024 },
  { label: "가로 · 9:7", width: 1152, height: 896 },
  { label: "가로 · 3:2", width: 1248, height: 832 },
  { label: "가로 · 7:4", width: 1344, height: 768 },
  { label: "가로 · 2:1", width: 1408, height: 704 },
] as const;

export const jobStatuses = [
  "draft",
  "uploading",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const jobPhases = [
  "preparing",
  "uploading",
  "queued",
  "loading_models",
  "training",
  "encoding",
  "sampling",
  "upscaling",
  "saving",
  "completed",
  "failed",
  "cancelled",
] as const;

export const jobKinds = ["generation", "upscale"] as const;

export const loraSelectionSchema = z.object({
  name: z.string().min(1),
  modelStrength: z.number().min(-10).max(10).default(1),
  clipStrength: z.number().min(-10).max(10).default(1),
  enabled: z.boolean().default(true),
});

export const taggingOptionsSchema = z.object({
  generalThreshold: z.number().min(0).max(1).default(0.35),
  characterThreshold: z.number().min(0).max(1).default(0.7),
  prependTags: z.string().default(", 3d, koikatsu (medium)"),
  appendTags: z.string().default("vrcg"),
  excludeTags: z.string().default(""),
  replaceTags: z.string().default(""),
  removeUnderscore: z.boolean().default(true),
});

export const trainingOptionsSchema = z.object({
  steps: z.number().int().min(0).max(100000).default(200),
  learningRate: z.number().min(0).max(1).default(0.001),
  networkDim: z.number().int().min(0).max(1024).default(16),
  networkAlpha: z.number().int().min(0).max(1024).default(1),
  resolution: z.string().default(""),
  gradientCheckpointing: z.boolean().default(true),
  cacheLatents: z.boolean().default(true),
  cacheTextEncoderOutputs: z.boolean().default(true),
  seed: z.number().int().min(-1).max(2147483647).default(42),
  forceRetrain: z.boolean().default(false),
  batchSize: z.number().int().min(0).max(256).default(0),
});

export const upscaleSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  method: z
    .enum(["nearest-exact", "bilinear", "area", "bicubic", "bislerp"])
    .default("bilinear"),
  scale: z.number().min(0.01).max(8).default(1.5),
  steps: z.number().int().min(1).max(10000).default(30),
  denoise: z.number().min(0).max(1).default(0.7),
});

export const upscaleJobRequestSchema = z
  .object({
    outputId: z.string().min(1).optional(),
    upscale: upscaleSettingsSchema
      .omit({ enabled: true })
      .partial()
      .optional(),
  })
  .default({});

export const generationConfigSchema = z.object({
  referenceAssetIds: z.array(z.string().min(1)).min(1),
  prompts: z
    .object({
      basePositive: z
        .string()
        .default("newest, masterpiece, very aesthetic, score_7, best quality"),
      positive: z.string().default(""),
      natural: z.string().default(""),
      baseNegative: z
        .string()
        .default(
          "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, signature, deviantart username, deviantart",
        ),
      negative: z
        .string()
        .default(
          "3d, koikatsu \\(medium\\)\nthick outlines, black outline\nshort sidetail, twintails, ",
        ),
    })
    .default({}),
  model: z.object({
    diffusionModel: z.string().min(1),
    clip: z.string().min(1),
    clipType: z.string().default("stable_diffusion"),
    vae: z.string().min(1),
    weightDtype: z.string().default("default"),
  }),
  loras: z.array(loraSelectionSchema).default([]),
  instantLora: z
    .object({
      profile: z.string().default("anima"),
      modelStrength: z.number().min(-10).max(10).default(0.7),
      clipStrength: z.number().min(-10).max(10).default(0.7),
      tagging: taggingOptionsSchema.default({}),
      training: trainingOptionsSchema.default({}),
    })
    .default({}),
  seed: z
    .object({
      mode: z.enum(["random", "fixed"]).default("random"),
      value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(42),
    })
    .default({}),
  sampling: z
    .object({
      sampler: z.string().default("er_sde"),
      scheduler: z.string().default("sgm_uniform"),
      steps: z.number().int().min(1).max(10000).default(30),
      denoise: z.number().min(0).max(1).default(1),
      cfg: z.number().min(0).max(100).default(5),
      cfgStart: z.number().min(0).max(1).default(0),
      cfgEnd: z.number().min(0).max(1).default(1),
    })
    .default({}),
  image: z
    .object({
      width: z.number().int().min(64).max(8192).multipleOf(8).default(704),
      height: z.number().int().min(64).max(8192).multipleOf(8).default(1408),
      batchSize: z.number().int().min(1).max(64).default(1),
      preset: z.string().default("1:2 - 704x1408"),
    })
    .default({}),
  upscale: upscaleSettingsSchema.default({}),
});

export type GenerationConfig = z.infer<typeof generationConfigSchema>;
export type LoraSelection = z.infer<typeof loraSelectionSchema>;
export type JobStatus = (typeof jobStatuses)[number];
export type JobPhase = (typeof jobPhases)[number];
export type JobKind = (typeof jobKinds)[number];
export type UpscaleJobRequest = z.infer<typeof upscaleJobRequestSchema>;

export interface AssetDto {
  id: string;
  sha256: string;
  name: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  url: string;
  createdAt: string;
}

export interface OutputDto {
  id: string;
  kind: "base" | "upscale";
  filename: string;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface JobEventDto {
  id: number;
  jobId: string;
  phase: JobPhase;
  message: string;
  progress: number | null;
  current: number | null;
  total: number | null;
  createdAt: string;
  preview?: JobPreviewDto;
}

export interface JobPreviewDto {
  url: string;
  mimeType: string;
  revision: number;
  step: number | null;
  total: number | null;
  updatedAt: string;
}

export interface JobDto {
  id: string;
  kind: JobKind;
  parentJobId: string | null;
  sourceOutputId: string | null;
  status: JobStatus;
  phase: JobPhase;
  comfyPromptId: string | null;
  queueNumber: number | null;
  config: GenerationConfig;
  actualSeed: number;
  autoTags: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assets: AssetDto[];
  outputs: OutputDto[];
  latestEvent?: JobEventDto;
  preview?: JobPreviewDto;
}

export const onboardingStepIds = [
  "welcome",
  "runtime",
  "models",
  "test_generation",
] as const;

export type OnboardingStepId = (typeof onboardingStepIds)[number];

export const onboardingPreferencesSchema = z
  .object({
    dismissed: z.boolean().default(false),
    completedSteps: z.array(z.enum(onboardingStepIds)).default([]),
  })
  .strict();

export const onboardingUpdateSchema = z
  .object({
    dismissed: z.boolean().optional(),
    completedSteps: z.array(z.enum(onboardingStepIds)).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one onboarding preference is required.",
  });

export type OnboardingPreferences = z.infer<
  typeof onboardingPreferencesSchema
>;

export interface OnboardingStepDto {
  id: OnboardingStepId;
  label: string;
  complete: boolean;
  blocking: boolean;
  message: string;
  actionHref: string;
}

export interface OnboardingStatusDto {
  version: 1;
  dismissed: boolean;
  complete: boolean;
  steps: OnboardingStepDto[];
}

export const storageItemKinds = [
  "asset",
  "output",
  "preview",
  "model_download",
] as const;

export type StorageItemKind = (typeof storageItemKinds)[number];

export interface StorageDependencyDto {
  kind: "job";
  id: string;
  label: string;
}

export interface StorageItemDto {
  kind: StorageItemKind;
  id: string;
  name: string;
  byteSize: number;
  createdAt: string | null;
  dependencies: StorageDependencyDto[];
  cleanupEligible: boolean;
  cleanupReason: string | null;
}

export interface StorageInventoryDto {
  totalBytes: number;
  categories: Array<{
    kind: StorageItemKind;
    byteSize: number;
    itemCount: number;
  }>;
  items: StorageItemDto[];
}

export const storageCleanupRequestSchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            kind: z.enum(storageItemKinds),
            id: z.string().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    dryRun: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.targets.map((target) => `${target.kind}:${target.id}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "Each cleanup target may only be selected once.",
      });
    }
  });

export type StorageCleanupRequest = z.infer<
  typeof storageCleanupRequestSchema
>;

export interface StorageCleanupResultDto {
  dryRun: boolean;
  reclaimedBytes: number;
  results: Array<{
    kind: StorageItemKind;
    id: string;
    eligible: boolean;
    deleted: boolean;
    byteSize: number;
    reason: string | null;
    dependencies: StorageDependencyDto[];
  }>;
}

export interface CapabilityIssue {
  kind: "node" | "model" | "endpoint";
  id: string;
  label: string;
  package?: string;
  installUrl?: string;
}

export interface CapabilityReport {
  compatible: boolean;
  comfyUrl: string;
  requiredNodes: string[];
  missing: CapabilityIssue[];
  optional: CapabilityIssue[];
}

export interface ComfyOptions {
  diffusionModels: string[];
  clips: string[];
  vaes: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  imagePresets: Array<{ label: string; width: number; height: number }>;
}

export interface TagSuggestion {
  tag: string;
  category: "general" | "artist" | "character" | "copyright" | "meta";
  count: number;
  description: string;
  aliases?: string[];
  cooccurrenceCount?: number;
  matchedContext?: string[];
}

export interface TagSearchResponse {
  tags: TagSuggestion[];
  related?: TagSuggestion[];
  meta?: {
    source: "danbooru" | "fallback";
    query: string;
    context: string[];
    cooccurrenceEnabled: boolean;
  };
}

export const runtimeModes = ["managed", "external"] as const;
export const runtimeStates = [
  "not_installed",
  "installing",
  "stopped",
  "starting",
  "ready",
  "stopping",
  "updating",
  "repairing",
  "failed",
] as const;

export const runtimeConfigSchema = z
  .object({
    mode: z.enum(runtimeModes).default("managed"),
    externalUrl: z.string().url().nullable().default(null),
    autoStart: z.boolean().default(true),
    stopWithApi: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.mode === "external" && !value.externalUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalUrl"],
        message: "An external ComfyUI URL is required in external mode.",
      });
    }
  });

export type RuntimeMode = (typeof runtimeModes)[number];
export type RuntimeState = (typeof runtimeStates)[number];
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export interface RuntimeHardwareDto {
  platform: string;
  architecture: string;
  supported: boolean;
  gpuName: string | null;
  driverVersion: string | null;
  vramBytes: number | null;
  freeDiskBytes: number | null;
  warnings: string[];
}

export interface RuntimeDto {
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
  hardware: RuntimeHardwareDto | null;
  activeOperationId: string | null;
}

export const operationKinds = [
  "runtime_install",
  "runtime_update",
  "runtime_repair",
  "model_download",
] as const;
export const operationStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type OperationKind = (typeof operationKinds)[number];
export type OperationStatus = (typeof operationStatuses)[number];

export interface OperationEventDto {
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

export interface OperationDto {
  id: string;
  kind: OperationKind;
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
  latestEvent?: OperationEventDto;
}

export const modelDownloadStates = [
  "resolving",
  "queued",
  "downloading",
  "paused",
  "verifying",
  "indexing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ModelDownloadState = (typeof modelDownloadStates)[number];
export type ModelDownloadProvider = "civitai" | "huggingface";
export const modelInstallationStatuses = [
  "not_installed",
  "installing",
  "installed",
] as const;
export type ModelInstallationStatus =
  (typeof modelInstallationStatuses)[number];
export const modelInstallTaskStatuses = [
  "installing",
  "installed",
  "failed",
] as const;
export type ModelInstallTaskStatus =
  (typeof modelInstallTaskStatuses)[number];
export type ModelDestinationKind =
  | "loras"
  | "diffusion_models"
  | "checkpoints"
  | "text_encoders"
  | "vae";

export interface ModelDestinationOptionDto {
  id: ModelDestinationKind;
  label: string;
  kind: ModelDestinationKind;
}

export interface CivitaiProviderStatusDto {
  provider: "civitai";
  available: boolean;
  tokenConfigured: boolean;
  supportedHosts: ["civitai.com", "civitai.red"];
  supportedFormats: [".safetensors"];
  managedDownloads: boolean;
  destinations: ModelDestinationOptionDto[];
  reason?: string;
  restartRequired?: boolean;
}

export interface CivitaiFileDto {
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

export interface CivitaiVersionDto {
  id: number;
  name: string;
  baseModel: string | null;
  createdAt: string | null;
  earlyAccessEndsAt: string | null;
  thumbnailUrl: string | null;
  trainedWords: string[];
  files: CivitaiFileDto[];
}

export interface CivitaiInspectDto {
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
  versions: CivitaiVersionDto[];
}

export type HuggingFaceAnimaFileKind =
  | "diffusion_model"
  | "text_encoder"
  | "vae";

export interface HuggingFaceAnimaFileDto {
  path: string;
  filename: string;
  kind: HuggingFaceAnimaFileKind;
  destinationRootId: Extract<
    ModelDestinationKind,
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

export interface HuggingFaceAnimaCatalogDto {
  provider: "huggingface";
  repository: "circlestone-labs/Anima";
  sourceUrl: string;
  revision: string;
  lastModified: string | null;
  license: string;
  licenseUrl: string;
  thumbnailUrl: string | null;
  files: HuggingFaceAnimaFileDto[];
}

export interface HuggingFaceAnimaProviderStatusDto {
  provider: "huggingface";
  available: boolean;
  repository: "circlestone-labs/Anima";
  managedDownloads: boolean;
  supportedFormats: [".safetensors"];
  destinations: ModelDestinationOptionDto[];
  reason?: string;
}

export const civitaiInspectRequestSchema = z.object({
  url: z.string().url().max(2_000),
});

export const modelDownloadCreateSchema = z.object({
  modelId: z.number().int().positive(),
  modelVersionId: z.number().int().positive(),
  fileId: z.number().int().positive().optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  destinationRootId: z.enum([
    "loras",
    "diffusion_models",
    "checkpoints",
  ]),
  relativeDir: z.string().max(240).default(""),
});

export type CivitaiInspectRequest = z.infer<
  typeof civitaiInspectRequestSchema
>;
export type ModelDownloadCreate = z.infer<
  typeof modelDownloadCreateSchema
>;

export const huggingFaceAnimaDownloadCreateSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^split_files\/(?:diffusion_models|text_encoders|vae)\/[^/]+\.safetensors$/,
    ),
  includeDependencies: z.boolean().default(true),
  acceptedLicense: z.literal(true),
});

export type HuggingFaceAnimaDownloadCreate = z.infer<
  typeof huggingFaceAnimaDownloadCreateSchema
>;

export interface HuggingFaceAnimaInstallDto {
  installationId: string;
  status: ModelInstallTaskStatus;
  progress: number;
  error?: string;
}

export interface ManagedModelInstallationDto {
  id: string;
  provider: ModelDownloadProvider;
  providerModelId: string;
  providerVersionId: string;
  providerFileId: string | null;
  modelName: string;
  versionName: string;
  filename: string;
  destinationRootId: ModelDestinationKind;
  relativeDir: string;
  sha256: string;
  storagePath: string;
  installedAt: string;
  updatedAt: string;
}

export interface ModelDownloadDto {
  id: string;
  operationId: string;
  state: ModelDownloadState;
  provider: ModelDownloadProvider;
  providerModelId: string;
  providerVersionId: string;
  providerFileId: string | null;
  modelId: number | null;
  modelVersionId: number | null;
  fileId: number | null;
  modelName: string;
  versionName: string;
  filename: string;
  destinationRootId: ModelDestinationKind;
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
