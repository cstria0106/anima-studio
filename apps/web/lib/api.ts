import {
  type CapabilitiesResponse,
  type CivitaiModelInspection,
  type CivitaiProviderStatus,
  type CivitaiModelInstallRequest,
  type ComfyRuntime,
  DEFAULT_DRAFT,
  EMPTY_OPTIONS,
  type GenerationDraft,
  type HealthResponse,
  type HuggingFaceAnimaInstallRequest,
  type HuggingFaceAnimaProviderResponse,
  type JobListResponse,
  type LongOperation,
  type LoraOption,
  type ModelInstallTask,
  type ModelOption,
  type OnboardingStatus,
  type OnboardingUpdate,
  type JobPreview,
  type ReferenceAsset,
  type RuntimeAction,
  type RuntimeActionResult,
  type RuntimeConfigUpdate,
  type RuntimeLogEntry,
  type RuntimeLogsResponse,
  type StudioJob,
  type StudioOptions,
  type StorageCleanupResult,
  type StorageCleanupTarget,
  type StorageInventory,
  type TagSuggestion,
} from "@/lib/types";

interface ApiGenerationConfig {
  referenceAssetIds: string[];
  prompts: GenerationDraft["prompts"];
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
  instantLora: {
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
  };
  seed: { mode: "random" | "fixed"; value: number };
  sampling: {
    sampler: string;
    scheduler: string;
    steps: number;
    denoise: number;
    cfg: number;
    cfgStart: number;
    cfgEnd: number;
  };
  image: {
    width: number;
    height: number;
    batchSize: number;
    preset: string;
  };
  upscale: {
    enabled: boolean;
    method: "nearest-exact" | "bilinear" | "area" | "bicubic" | "bislerp";
    scale: number;
    steps: number;
    denoise: number;
  };
}

interface ApiJobDto {
  id: string;
  parentJobId?: string | null;
  sourceOutputId?: string | null;
  kind?: string | null;
  status: StudioJob["status"];
  phase: string;
  comfyPromptId: string | null;
  queueNumber: number | null;
  config: ApiGenerationConfig;
  actualSeed: number;
  autoTags: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assets: Array<{
    id: string;
    sha256: string;
    name: string;
    url: string;
    width: number | null;
    height: number | null;
  }>;
  outputs: Array<{
    id: string;
    kind: "base" | "upscale";
    url: string;
    width: number | null;
    height: number | null;
  }>;
  preview?:
    | JobPreview
    | string
    | {
        url?: string;
        previewUrl?: string;
        mimeType?: string;
        revision?: string | number;
        step?: number | null;
        current?: number | null;
        total?: number | null;
        updatedAt?: string;
      };
  previewUrl?: string;
  latestEvent?: {
    phase: string;
    progress: number | null;
    message: string;
  };
}

function normalizePreview(
  value: ApiJobDto["preview"] | undefined,
  fallbackUrl?: string,
): JobPreview | undefined {
  if (typeof value === "string") return { url: value };
  if (value && typeof value === "object") {
    const previewUrl =
      "previewUrl" in value ? value.previewUrl : undefined;
    const current = "current" in value ? value.current : undefined;
    const url = value.url ?? previewUrl ?? fallbackUrl;
    if (!url) return undefined;
    return {
      url,
      mimeType: value.mimeType,
      revision: value.revision,
      step: value.step ?? current ?? undefined,
      total: value.total ?? undefined,
      updatedAt: value.updatedAt,
    };
  }
  return fallbackUrl ? { url: fallbackUrl } : undefined;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    let message = `요청에 실패했습니다 (${response.status})`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.message === "string") {
        message = record.message;
      } else if (typeof record.error === "string") {
        message = record.error;
      } else if (record.error && typeof record.error === "object") {
        const nested = record.error as Record<string, unknown>;
        if (typeof nested.message === "string") message = nested.message;
      }
    } else if (typeof value === "string" && value.trim()) {
      message = value;
    }
    throw new ApiError(message, response.status, value);
  }
  return value as T;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  return parseResponse<T>(response);
}

function modelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { name: item, value: item };
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const optionValue = String(
        record.value ?? record.path ?? record.name ?? record.filename ?? "",
      );
      if (!optionValue) return null;
      return {
        name: String(record.label ?? record.name ?? optionValue),
        value: optionValue,
      };
    })
    .filter((option): option is ModelOption => Boolean(option));
}

function loraOptions(value: unknown): LoraOption[] {
  if (!Array.isArray(value)) return [];
  const result: LoraOption[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push({ name: item, value: item, triggerWords: [] });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const optionValue = String(
      record.value ?? record.path ?? record.name ?? record.filename ?? "",
    );
    if (!optionValue) continue;
    const rawTriggers =
      record.triggerWords ?? record.trigger_words ?? record.triggers;
    result.push({
      name: String(record.label ?? record.name ?? optionValue),
      value: optionValue,
      triggerWords: Array.isArray(rawTriggers)
        ? rawTriggers.map(String)
        : typeof rawTriggers === "string"
          ? rawTriggers
              .split(",")
              .map((word) => word.trim())
              .filter(Boolean)
          : [],
      thumbnailUrl:
        typeof record.thumbnailUrl === "string"
          ? record.thumbnailUrl
          : typeof record.thumbnail_url === "string"
            ? record.thumbnail_url
            : undefined,
    });
  }
  return result;
}

export async function getHealth(signal?: AbortSignal) {
  const raw = await apiFetch<Record<string, unknown>>("/api/health", {
    signal,
  });
  const database =
    raw.database && typeof raw.database === "object"
      ? (raw.database as Record<string, unknown>)
      : null;
  const comfy =
    raw.comfy && typeof raw.comfy === "object"
      ? (raw.comfy as Record<string, unknown>)
      : null;
  const queue =
    raw.queue && typeof raw.queue === "object"
      ? (raw.queue as Record<string, unknown>)
      : null;
  return {
    ok: Boolean(raw.ok),
    database:
      database !== null ? Boolean(database.connected) : Boolean(raw.database),
    comfyui: Boolean(comfy?.connected ?? raw.comfyui),
    comfyUrl:
      typeof (comfy?.url ?? raw.comfyUrl) === "string"
        ? String(comfy?.url ?? raw.comfyUrl)
        : undefined,
    queue: queue
      ? {
          running: Number(queue.running ?? 0),
          pending: Number(queue.pending ?? 0),
        }
      : undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    version: typeof raw.version === "string" ? raw.version : undefined,
  } satisfies HealthResponse;
}

export async function getCapabilities(signal?: AbortSignal) {
  const value = await apiFetch<
    CapabilitiesResponse & {
      compatible?: boolean;
      missing?: Array<{
        kind?: string;
        id?: string;
        label?: string;
        package?: string;
        installUrl?: string;
      }>;
      optional?: Array<{
        kind?: string;
        id?: string;
        label?: string;
        package?: string;
        installUrl?: string;
      }>;
    }
  >("/api/capabilities", {
    signal,
  });
  return {
    ready: Boolean(value.ready ?? value.compatible),
    comfyUrl: value.comfyUrl,
    requiredNodes: value.requiredNodes,
    missingNodes: (value.missingNodes ?? value.missing ?? []).map((issue) => {
      const record = issue as Record<string, unknown>;
      return {
        ...issue,
        classType: String(record.classType ?? record.id ?? ""),
        packageName:
          typeof record.packageName === "string"
            ? record.packageName
            : typeof record.package === "string"
              ? record.package
              : undefined,
      };
    }),
    optional: value.optional,
    incompatibleNodes: value.incompatibleNodes ?? [],
    warnings: value.warnings ?? [],
    checkedAt: value.checkedAt,
  } satisfies CapabilitiesResponse;
}

export async function getOptions(signal?: AbortSignal): Promise<StudioOptions> {
  const raw = await apiFetch<Record<string, unknown>>("/api/options", {
    signal,
  });
  const data =
    raw.options && typeof raw.options === "object"
      ? (raw.options as Record<string, unknown>)
      : raw;
  return {
    diffusionModels: modelOptions(
      data.diffusionModels ?? data.diffusion_models ?? data.models,
    ),
    clips: modelOptions(data.clips ?? data.clipModels ?? data.clip_models),
    vaes: modelOptions(data.vaes ?? data.vaeModels ?? data.vae_models),
    loras: loraOptions(data.loras),
    samplers: Array.isArray(data.samplers)
      ? data.samplers.map(String)
      : EMPTY_OPTIONS.samplers,
    schedulers: Array.isArray(data.schedulers)
      ? data.schedulers.map(String)
      : EMPTY_OPTIONS.schedulers,
    upscaleMethods: Array.isArray(data.upscaleMethods ?? data.upscale_methods)
      ? ((data.upscaleMethods ?? data.upscale_methods) as unknown[]).map(String)
      : [],
    presets: Array.isArray(data.presets)
      ? data.presets
          .map((preset) => {
            if (!preset || typeof preset !== "object") return null;
            const record = preset as Record<string, unknown>;
            const width = Number(record.width);
            const height = Number(record.height);
            if (!width || !height) return null;
            return {
              label: String(record.label ?? `${width} × ${height}`),
              width,
              height,
            };
          })
          .filter(
            (
              preset,
            ): preset is { label: string; width: number; height: number } =>
              Boolean(preset),
          )
      : Array.isArray(data.imagePresets)
        ? (data.imagePresets as Array<Record<string, unknown>>)
            .map((preset) => {
              const width = Number(preset.width);
              const height = Number(preset.height);
              if (!width || !height) return null;
              return {
                label: String(preset.label ?? `${width} × ${height}`),
                width,
                height,
              };
            })
            .filter(
              (
                preset,
              ): preset is { label: string; width: number; height: number } =>
                Boolean(preset),
            )
        : [],
  };
}

export async function searchTags(
  query: string,
  options: {
    context?: readonly string[];
    limit?: number;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams({ q: query });
  const context = [...new Set(options.context ?? [])]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(-16);
  if (context.length) params.set("context", context.join(","));
  if (options.limit) params.set("limit", String(options.limit));
  const raw = await apiFetch<
    TagSuggestion[] | { tags: TagSuggestion[] | string[] }
  >(`/api/tags?${params}`, { signal: options.signal });
  const values = Array.isArray(raw) ? raw : raw.tags;
  return values.map((item) =>
    typeof item === "string" ? { tag: item } : item,
  );
}

export async function uploadAsset(
  file: File,
  signal?: AbortSignal,
): Promise<ReferenceAsset> {
  const body = new FormData();
  body.append("files", file);
  const raw = await apiFetch<
    | ReferenceAsset
    | { asset: ReferenceAsset }
    | { assets: ReferenceAsset[] }
    | {
        id: string;
        sha256?: string;
        name?: string;
        url?: string;
        width?: number;
        height?: number;
      }
  >("/api/assets", {
    method: "POST",
    body,
    signal,
  });
  const asset =
    "assets" in raw
      ? raw.assets[0]
      : "asset" in raw
        ? raw.asset
        : raw;
  if (!asset) throw new ApiError("업로드 결과에 에셋이 없습니다.", 502);
  const id = String(asset.id);
  return {
    id,
    ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
    name: asset.name ?? file.name,
    url: asset.url ?? `/api/assets/${encodeURIComponent(id)}`,
    width: asset.width,
    height: asset.height,
    size: file.size,
    status: "ready",
  };
}

export async function createJob(draft: GenerationDraft): Promise<StudioJob> {
  const payload = { config: draftToConfig(draft) };
  const raw = await apiFetch<
    ApiJobDto | StudioJob | { job: ApiJobDto | StudioJob }
  >("/api/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeJob(raw);
}

export async function getStorage(
  signal?: AbortSignal,
): Promise<StorageInventory> {
  const raw = await apiFetch<{ storage: StorageInventory }>("/api/storage", {
    signal,
  });
  return raw.storage;
}

export async function cleanupStorage(
  targets: StorageCleanupTarget[],
  dryRun: boolean,
): Promise<StorageCleanupResult> {
  const raw = await apiFetch<{ cleanup: StorageCleanupResult }>(
    "/api/storage/cleanup",
    {
      method: "POST",
      body: JSON.stringify({ targets, dryRun }),
    },
  );
  return raw.cleanup;
}

export async function getOnboarding(
  signal?: AbortSignal,
): Promise<OnboardingStatus> {
  const raw = await apiFetch<{ onboarding: OnboardingStatus }>(
    "/api/onboarding",
    { signal },
  );
  return raw.onboarding;
}

export async function updateOnboarding(
  patch: OnboardingUpdate,
): Promise<OnboardingStatus> {
  const raw = await apiFetch<{ onboarding: OnboardingStatus }>(
    "/api/onboarding",
    {
      method: "PUT",
      body: JSON.stringify(patch),
    },
  );
  return raw.onboarding;
}

function draftToConfig(draft: GenerationDraft): ApiGenerationConfig {
  return {
    referenceAssetIds: draft.referenceAssets.map((asset) => asset.id),
    prompts: draft.prompts,
    model: {
      diffusionModel: draft.models.diffusion,
      clip: draft.models.clip,
      clipType: "stable_diffusion",
      vae: draft.models.vae,
      weightDtype: "default",
    },
    loras: draft.loras.map((lora) => ({
      name: lora.path,
      modelStrength: lora.modelStrength,
      clipStrength: lora.clipStrength,
      enabled: lora.enabled,
    })),
    instantLora: {
      profile: "anima",
      modelStrength: draft.instantLora.modelStrength,
      clipStrength: draft.instantLora.clipStrength,
      tagging: {
        generalThreshold: draft.tagging.threshold,
        characterThreshold: draft.tagging.characterThreshold,
        prependTags: draft.tagging.prependTags,
        appendTags: draft.tagging.appendTags,
        excludeTags: draft.tagging.excludeTags,
        replaceTags: draft.tagging.replaceTags,
        removeUnderscore: draft.tagging.removeUnderscore,
      },
      training: {
        steps: draft.instantLora.trainingSteps,
        learningRate: draft.instantLora.learningRate,
        networkDim: draft.instantLora.dimension,
        networkAlpha: draft.instantLora.alpha,
        resolution: draft.instantLora.resolution,
        gradientCheckpointing: draft.instantLora.gradientCheckpointing,
        cacheLatents: draft.instantLora.cache,
        cacheTextEncoderOutputs:
          draft.instantLora.cacheTextEncoderOutputs,
        seed: draft.instantLora.seed,
        forceRetrain: draft.instantLora.forceRetrain,
        batchSize: draft.instantLora.batchSize,
      },
    },
    seed: {
      mode: draft.sampling.seedMode,
      value: draft.sampling.seed,
    },
    sampling: {
      sampler: draft.sampling.sampler,
      scheduler: draft.sampling.scheduler,
      steps: draft.sampling.steps,
      denoise: draft.sampling.denoise,
      cfg: draft.sampling.cfg,
      cfgStart: draft.sampling.cfgStart,
      cfgEnd: draft.sampling.cfgEnd,
    },
    image: {
      width: draft.sampling.width,
      height: draft.sampling.height,
      batchSize: draft.sampling.batchSize,
      preset: `${draft.sampling.width}x${draft.sampling.height}`,
    },
    upscale: {
      ...draft.upscale,
      method:
        draft.upscale.method as ApiGenerationConfig["upscale"]["method"],
    },
  };
}

function configToDraft(config: ApiGenerationConfig): GenerationDraft {
  return {
    ...DEFAULT_DRAFT,
    referenceAssets: [],
    prompts: {
      ...DEFAULT_DRAFT.prompts,
      ...(config.prompts ?? {}),
    },
    models: {
      diffusion:
        config.model?.diffusionModel ?? DEFAULT_DRAFT.models.diffusion,
      clip: config.model?.clip ?? DEFAULT_DRAFT.models.clip,
      vae: config.model?.vae ?? DEFAULT_DRAFT.models.vae,
    },
    loras: Array.isArray(config.loras)
      ? config.loras.map(
          (lora, index): GenerationDraft["loras"][number] => ({
            id: `history_lora_${index}_${lora.name}`,
            name: lora.name,
            path: lora.name,
            enabled: lora.enabled !== false,
            modelStrength: lora.modelStrength,
            clipStrength: lora.clipStrength,
            triggerWords: [],
          }),
        )
      : [],
    sampling: {
      ...DEFAULT_DRAFT.sampling,
      seedMode: config.seed?.mode ?? DEFAULT_DRAFT.sampling.seedMode,
      seed: config.seed?.value ?? DEFAULT_DRAFT.sampling.seed,
      ...(config.sampling ?? {}),
      width: config.image?.width ?? DEFAULT_DRAFT.sampling.width,
      height: config.image?.height ?? DEFAULT_DRAFT.sampling.height,
      batchSize:
        config.image?.batchSize ?? DEFAULT_DRAFT.sampling.batchSize,
    },
    instantLora: {
      ...DEFAULT_DRAFT.instantLora,
      modelStrength:
        config.instantLora?.modelStrength ??
        DEFAULT_DRAFT.instantLora.modelStrength,
      clipStrength:
        config.instantLora?.clipStrength ??
        DEFAULT_DRAFT.instantLora.clipStrength,
      trainingSteps:
        config.instantLora?.training?.steps ??
        DEFAULT_DRAFT.instantLora.trainingSteps,
      learningRate:
        config.instantLora?.training?.learningRate ??
        DEFAULT_DRAFT.instantLora.learningRate,
      dimension:
        config.instantLora?.training?.networkDim ??
        DEFAULT_DRAFT.instantLora.dimension,
      alpha:
        config.instantLora?.training?.networkAlpha ??
        DEFAULT_DRAFT.instantLora.alpha,
      cache:
        config.instantLora?.training?.cacheLatents ??
        DEFAULT_DRAFT.instantLora.cache,
      cacheTextEncoderOutputs:
        config.instantLora?.training?.cacheTextEncoderOutputs ??
        DEFAULT_DRAFT.instantLora.cacheTextEncoderOutputs,
      gradientCheckpointing:
        config.instantLora?.training?.gradientCheckpointing ??
        DEFAULT_DRAFT.instantLora.gradientCheckpointing,
      forceRetrain:
        config.instantLora?.training?.forceRetrain ??
        DEFAULT_DRAFT.instantLora.forceRetrain,
      seed:
        config.instantLora?.training?.seed ??
        DEFAULT_DRAFT.instantLora.seed,
      batchSize:
        config.instantLora?.training?.batchSize ??
        DEFAULT_DRAFT.instantLora.batchSize,
      resolution:
        config.instantLora?.training?.resolution ??
        DEFAULT_DRAFT.instantLora.resolution,
    },
    tagging: {
      ...DEFAULT_DRAFT.tagging,
      threshold:
        config.instantLora?.tagging?.generalThreshold ??
        DEFAULT_DRAFT.tagging.threshold,
      characterThreshold:
        config.instantLora?.tagging?.characterThreshold ??
        DEFAULT_DRAFT.tagging.characterThreshold,
      prependTags:
        config.instantLora?.tagging?.prependTags ??
        DEFAULT_DRAFT.tagging.prependTags,
      appendTags:
        config.instantLora?.tagging?.appendTags ??
        DEFAULT_DRAFT.tagging.appendTags,
      excludeTags:
        config.instantLora?.tagging?.excludeTags ??
        DEFAULT_DRAFT.tagging.excludeTags,
      replaceTags:
        config.instantLora?.tagging?.replaceTags ??
        DEFAULT_DRAFT.tagging.replaceTags,
      removeUnderscore:
        config.instantLora?.tagging?.removeUnderscore ??
        DEFAULT_DRAFT.tagging.removeUnderscore,
    },
    upscale: {
      ...DEFAULT_DRAFT.upscale,
      ...(config.upscale ?? {}),
    },
  };
}

function normalizeJob(
  raw:
    | StudioJob
    | ApiJobDto
    | { job: StudioJob | ApiJobDto },
) {
  const value = "job" in raw ? raw.job : raw;
  if ("settings" in value) return value;
  const settings = configToDraft(value.config);
  if (
    typeof value.actualSeed === "number" &&
    Number.isFinite(value.actualSeed)
  ) {
    settings.sampling.seedMode = "fixed";
    settings.sampling.seed = value.actualSeed;
  }
  settings.referenceAssets = value.assets.map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    name: asset.name,
    url: asset.url,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    status: "ready",
  }));
  return {
    id: value.id,
    parentJobId: value.parentJobId ?? undefined,
    sourceOutputId: value.sourceOutputId ?? undefined,
    kind: value.kind ?? undefined,
    status: value.status,
    stage: value.phase ?? value.latestEvent?.phase,
    progress: value.latestEvent?.progress ?? undefined,
    queuePosition: value.queueNumber ?? undefined,
    promptId: value.comfyPromptId ?? undefined,
    createdAt: value.createdAt,
    startedAt: value.startedAt ?? undefined,
    completedAt: value.completedAt ?? undefined,
    error: value.error ?? undefined,
    settings,
    outputs: value.outputs.map((output) => ({
      id: output.id,
      url: output.url,
      kind: output.kind,
      width: output.width ?? undefined,
      height: output.height ?? undefined,
    })),
    preview: normalizePreview(value.preview, value.previewUrl),
    autoTags: value.autoTags
      ? value.autoTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
  } satisfies StudioJob;
}

export async function getJob(id: string, signal?: AbortSignal) {
  const raw = await apiFetch<
    StudioJob | ApiJobDto | { job: StudioJob | ApiJobDto }
  >(
    `/api/jobs/${encodeURIComponent(id)}`,
    { signal },
  );
  return normalizeJob(raw);
}

export async function getJobs(
  params: { status?: string; model?: string; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<JobListResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const raw = await apiFetch<
    | Array<StudioJob | ApiJobDto>
    | {
        jobs?: Array<StudioJob | ApiJobDto>;
        items?: Array<StudioJob | ApiJobDto>;
        nextCursor?: string;
      }
  >(
    `/api/jobs${query.size ? `?${query}` : ""}`,
    { signal },
  );
  if (Array.isArray(raw)) return { jobs: raw.map(normalizeJob) };
  const values = "jobs" in raw ? raw.jobs : raw.items;
  return {
    jobs: (values ?? []).map(normalizeJob),
    nextCursor: raw.nextCursor,
  };
}

export async function cancelJob(id: string) {
  const raw = await apiFetch<
    StudioJob | ApiJobDto | { job: StudioJob | ApiJobDto }
  >(
    `/api/jobs/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
  return normalizeJob(raw);
}

export async function upscaleJob(
  id: string,
  settings: GenerationDraft["upscale"],
  outputId?: string,
) {
  const raw = await apiFetch<
    StudioJob | ApiJobDto | { job: StudioJob | ApiJobDto }
  >(`/api/jobs/${encodeURIComponent(id)}/upscale`, {
    method: "POST",
    body: JSON.stringify({
      ...(outputId ? { outputId } : {}),
      upscale: {
        method: settings.method,
        scale: settings.scale,
        steps: settings.steps,
        denoise: settings.denoise,
      },
    }),
  });
  return normalizeJob(raw);
}

function unwrapRecord<T>(
  value: T | Record<string, unknown>,
  key: string,
): T {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key] as T;
  }
  return value as T;
}

export async function getComfyRuntime(
  signal?: AbortSignal,
): Promise<ComfyRuntime> {
  const raw = await apiFetch<ComfyRuntime | { runtime: ComfyRuntime }>(
    "/api/comfy/runtime",
    { signal },
  );
  return unwrapRecord<ComfyRuntime>(raw, "runtime");
}

export async function updateComfyRuntime(
  config: RuntimeConfigUpdate,
): Promise<ComfyRuntime> {
  const raw = await apiFetch<ComfyRuntime | { runtime: ComfyRuntime }>(
    "/api/comfy/runtime",
    {
      method: "PUT",
      body: JSON.stringify(config),
    },
  );
  return unwrapRecord<ComfyRuntime>(raw, "runtime");
}

export async function runComfyRuntimeAction(
  action: RuntimeAction,
  options: { force?: boolean } = {},
): Promise<RuntimeActionResult> {
  const raw = await apiFetch<
    | RuntimeActionResult
    | ComfyRuntime
    | LongOperation
    | { runtime?: ComfyRuntime; operation?: LongOperation }
  >(`/api/comfy/runtime/${action}`, {
    method: "POST",
    body:
      options.force === undefined
        ? undefined
        : JSON.stringify({ force: options.force }),
  });

  const record =
    raw && typeof raw === "object"
      ? (raw as unknown as Record<string, unknown>)
      : {};
  const runtime =
    ("runtime" in record ? record.runtime : undefined) as
      | ComfyRuntime
      | undefined;
  const operation =
    ("operation" in record
      ? record.operation
      : "kind" in record && "status" in record && !("state" in record)
        ? raw
        : undefined) as LongOperation | undefined;
  const directRuntime =
    "state" in record && "mode" in record ? (raw as ComfyRuntime) : undefined;

  return {
    runtime: runtime ?? directRuntime ?? (await getComfyRuntime()),
    ...(operation ? { operation } : {}),
  };
}

function normalizeRuntimeLog(
  value: unknown,
  index: number,
): RuntimeLogEntry | null {
  if (typeof value === "string") {
    return {
      id: index,
      timestamp: "",
      stream: "stdout",
      message: value,
    };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const streamValue = String(record.stream ?? record.source ?? "stdout");
  const stream: RuntimeLogEntry["stream"] =
    streamValue === "stderr" || streamValue === "system"
      ? streamValue
      : "stdout";
  const levelValue = String(record.level ?? "");
  const level: RuntimeLogEntry["level"] =
    levelValue === "debug" ||
    levelValue === "info" ||
    levelValue === "warning" ||
    levelValue === "error"
      ? levelValue
      : undefined;
  return {
    id: String(record.id ?? record.sequence ?? index),
    timestamp: String(
      record.timestamp ?? record.createdAt ?? record.time ?? "",
    ),
    stream,
    ...(level ? { level } : {}),
    message: String(record.message ?? record.line ?? record.text ?? ""),
  };
}

export async function getRuntimeLogs(
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<RuntimeLogsResponse> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const raw = await apiFetch<
    | RuntimeLogEntry[]
    | {
        entries?: unknown[];
        logs?: unknown[];
        lines?: unknown[];
        nextCursor?: string;
        cursor?: string;
      }
  >(`/api/comfy/runtime/logs${params.size ? `?${params}` : ""}`, {
    signal: options.signal,
  });
  const values = Array.isArray(raw)
    ? raw
    : (raw.entries ?? raw.logs ?? raw.lines ?? []);
  return {
    entries: values
      .map(normalizeRuntimeLog)
      .filter((entry): entry is RuntimeLogEntry => Boolean(entry)),
    nextCursor: Array.isArray(raw)
      ? undefined
      : (raw.nextCursor ?? raw.cursor),
  };
}

export async function getOperation(
  id: string,
  signal?: AbortSignal,
): Promise<LongOperation> {
  const raw = await apiFetch<LongOperation | { operation: LongOperation }>(
    `/api/operations/${encodeURIComponent(id)}`,
    { signal },
  );
  return unwrapRecord<LongOperation>(raw, "operation");
}

export function runtimeLogEventsUrl(cursor?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return `/api/comfy/runtime/logs/events${params.size ? `?${params}` : ""}`;
}

export function operationEventsUrl(id: string) {
  return `/api/operations/${encodeURIComponent(id)}/events`;
}

export async function getCivitaiProvider(
  signal?: AbortSignal,
): Promise<CivitaiProviderStatus> {
  const raw = await apiFetch<
    CivitaiProviderStatus | { provider: CivitaiProviderStatus }
  >("/api/download-providers/civitai", { signal });
  const provider = unwrapRecord<CivitaiProviderStatus>(raw, "provider");
  return {
    provider: "civitai",
    available: Boolean(provider.available),
    tokenConfigured: Boolean(provider.tokenConfigured),
    supportedHosts: provider.supportedHosts ?? ["civitai.com", "civitai.red"],
    supportedFormats: provider.supportedFormats ?? [".safetensors"],
    managedDownloads: Boolean(provider.managedDownloads),
    destinations: Array.isArray(provider.destinations)
      ? provider.destinations
      : [],
    ...(provider.reason ? { reason: provider.reason } : {}),
    ...(provider.restartRequired !== undefined
      ? { restartRequired: provider.restartRequired }
      : {}),
  };
}

function normalizeCivitaiProvider(
  raw: CivitaiProviderStatus | { provider: CivitaiProviderStatus },
): CivitaiProviderStatus {
  const provider = unwrapRecord<CivitaiProviderStatus>(raw, "provider");
  return {
    provider: "civitai",
    available: Boolean(provider.available),
    tokenConfigured: Boolean(provider.tokenConfigured),
    supportedHosts: provider.supportedHosts ?? ["civitai.com", "civitai.red"],
    supportedFormats: provider.supportedFormats ?? [".safetensors"],
    managedDownloads: Boolean(provider.managedDownloads),
    destinations: Array.isArray(provider.destinations)
      ? provider.destinations
      : [],
    ...(provider.reason ? { reason: provider.reason } : {}),
    ...(provider.restartRequired !== undefined
      ? { restartRequired: provider.restartRequired }
      : {}),
  };
}

export async function setCivitaiToken(
  token: string,
): Promise<CivitaiProviderStatus> {
  const raw = await apiFetch<
    CivitaiProviderStatus | { provider: CivitaiProviderStatus }
  >("/api/download-providers/civitai/token", {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
  return normalizeCivitaiProvider(raw);
}

export async function clearCivitaiToken(): Promise<CivitaiProviderStatus> {
  const raw = await apiFetch<
    CivitaiProviderStatus | { provider: CivitaiProviderStatus } | void
  >("/api/download-providers/civitai/token", {
    method: "DELETE",
  });
  if (raw && typeof raw === "object") {
    return normalizeCivitaiProvider(
      raw as CivitaiProviderStatus | { provider: CivitaiProviderStatus },
    );
  }
  return getCivitaiProvider();
}

export async function inspectCivitaiModel(
  url: string,
): Promise<CivitaiModelInspection> {
  const raw = await apiFetch<
    CivitaiModelInspection | { model: CivitaiModelInspection }
  >("/api/model-installations/civitai/inspect", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  return unwrapRecord<CivitaiModelInspection>(raw, "model");
}

export async function getHuggingFaceAnimaCatalog(
  signal?: AbortSignal,
): Promise<HuggingFaceAnimaProviderResponse> {
  return apiFetch<HuggingFaceAnimaProviderResponse>(
    "/api/download-providers/huggingface/anima",
    { signal },
  );
}

export async function installHuggingFaceAnima(
  input: HuggingFaceAnimaInstallRequest,
): Promise<ModelInstallTask> {
  return apiFetch<ModelInstallTask>(
    "/api/model-installations/anima",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function createCivitaiModelInstallation(
  input: CivitaiModelInstallRequest,
): Promise<ModelInstallTask> {
  return apiFetch<ModelInstallTask>(
    "/api/model-installations/civitai",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function removeModelInstallation(id: string): Promise<void> {
  await apiFetch<{ installationId: string }>(
    `/api/model-installations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function modelInstallationEventsUrl(id: string) {
  return `/api/model-installations/${encodeURIComponent(id)}/events`;
}
