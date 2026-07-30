import type {
  CapabilitiesResponse,
  CharacterProfile,
  GenerationDraft,
  HealthResponse,
  ModelPack,
  RuntimeHardware,
  StudioOptions,
} from "@/lib/types";

export type CreateStepId = "reference" | "prompt" | "models" | "generation";
export type SettingsSection = "overview" | "runtime" | "models" | "storage";

export const SETTINGS_SECTION_STORAGE_KEY =
  "anima-studio:settings-section:v1";

export function rememberSettingsSection(section: SettingsSection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
}

export interface PreflightIssue {
  code:
    | "comfy_offline"
    | "capabilities_missing"
    | "options_loading"
    | "reference_missing"
    | "reference_uploading"
    | "diffusion_required"
    | "clip_required"
    | "vae_required"
    | "diffusion_missing"
    | "clip_missing"
    | "vae_missing"
    | "lora_missing";
  message: string;
  stepId: CreateStepId;
  fieldId?: string;
  severity: "error" | "warning" | "info";
}

export type WorkloadRisk = "normal" | "caution" | "high";

interface WorkloadEstimateInput {
  width: number;
  height: number;
  batchSize: number;
  trainingSteps: number;
  samplingSteps: number;
  upscaleSteps: number;
  upscaleScale: number;
  referenceCount: number;
  upscaleEnabled: boolean;
  jobCount?: number;
}

export interface WorkloadEstimate {
  megapixels: number;
  estimatedVramGiB: number;
  availableVramGiB: number | null;
  vramRatio: number | null;
  lowerSeconds: number;
  upperSeconds: number;
  totalOutputCount: number;
  totalOutputMegapixels: number;
  jobCount: number;
  risk: WorkloadRisk;
  reasons: string[];
}

interface PreflightInput {
  draft: GenerationDraft;
  options: StudioOptions;
  optionsLoading: boolean;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
}

function normalizedModel(value: string) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function installed(
  value: string,
  options: Array<{ value: string }>,
) {
  const normalized = normalizedModel(value);
  return options.some((option) => normalizedModel(option.value) === normalized);
}

export function clearModelAndLoraSelections(
  draft: GenerationDraft,
): GenerationDraft {
  return {
    ...draft,
    models: {
      diffusion: "",
      clip: "",
      vae: "",
    },
    loras: [],
  };
}

export function buildPreflightIssues({
  draft,
  options,
  optionsLoading,
  health,
  capabilities,
}: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const connected = Boolean(
    health?.comfyui || (health?.ok && health.comfyui !== false),
  );

  if (!connected) {
    issues.push({
      code: "comfy_offline",
      message: "ComfyUI 연결을 확인해주세요.",
      stepId: "generation",
      severity: "error",
    });
  }
  if (capabilities && !capabilities.ready) {
    issues.push({
      code: "capabilities_missing",
      message: "필수 노드 또는 모델을 먼저 설치해주세요.",
      stepId: "models",
      severity: "error",
    });
  }
  if (optionsLoading) {
    issues.push({
      code: "options_loading",
      message: "설치된 모델과 LoRA 목록을 확인하고 있습니다.",
      stepId: "models",
      severity: "error",
    });
  }

  const readyAssets = draft.referenceAssets.filter(
    (asset) => asset.status === "ready",
  );
  if (!readyAssets.length) {
    issues.push({
      code: "reference_missing",
      message: "참조 이미지를 1장 이상 추가해주세요.",
      stepId: "reference",
      severity: "error",
    });
  }
  if (draft.referenceAssets.some((asset) => asset.status === "uploading")) {
    issues.push({
      code: "reference_uploading",
      message: "참조 이미지 업로드가 끝날 때까지 기다려주세요.",
      stepId: "reference",
      severity: "error",
    });
  }

  const requiredModels: Array<{
    value: string;
    options: Array<{ value: string }>;
    requiredCode: PreflightIssue["code"];
    missingCode: PreflightIssue["code"];
    label: string;
    fieldId: string;
  }> = [
    {
      value: draft.models.diffusion,
      options: options.diffusionModels,
      requiredCode: "diffusion_required",
      missingCode: "diffusion_missing",
      label: "기반 모델",
      fieldId: "diffusion-model",
    },
    {
      value: draft.models.clip,
      options: options.clips,
      requiredCode: "clip_required",
      missingCode: "clip_missing",
      label: "CLIP",
      fieldId: "clip-model",
    },
    {
      value: draft.models.vae,
      options: options.vaes,
      requiredCode: "vae_required",
      missingCode: "vae_missing",
      label: "VAE",
      fieldId: "vae-model",
    },
  ];

  if (!optionsLoading) {
    for (const model of requiredModels) {
      if (!model.value) {
        issues.push({
          code: model.requiredCode,
          message: `${model.label}를 선택해주세요.`,
          stepId: "models",
          fieldId: model.fieldId,
          severity: "error",
        });
      } else if (!installed(model.value, model.options)) {
        issues.push({
          code: model.missingCode,
          message: `${model.label} “${model.value}”이(가) 현재 ComfyUI에 없습니다.`,
          stepId: "models",
          fieldId: model.fieldId,
          severity: "error",
        });
      }
    }

    const missingLora = draft.loras.find(
      (lora) =>
        lora.enabled &&
        !installed(lora.path, options.loras),
    );
    if (missingLora) {
      issues.push({
        code: "lora_missing",
        message: `LoRA “${missingLora.name}”가 현재 ComfyUI에 없습니다.`,
        stepId: "models",
        fieldId: "lora-options",
        severity: "error",
      });
    }
  }

  return issues;
}

export function estimateWorkload(
  input: WorkloadEstimateInput,
  hardware: RuntimeHardware | null,
): WorkloadEstimate {
  const jobCount = Math.max(1, Math.round(input.jobCount ?? 1));
  const batchSize = Math.max(1, input.batchSize);
  const megapixels = (input.width * input.height) / 1_000_000;
  const upscaleScale = input.upscaleEnabled
    ? Math.max(1, input.upscaleScale)
    : 1;
  const estimatedVramGiB =
    5.5 +
    megapixels * 2.4 * batchSize +
    Math.min(4, input.referenceCount * 0.45) +
    (input.upscaleEnabled ? 2.5 : 0);
  const availableVramGiB = hardware?.vramBytes
    ? hardware.vramBytes / 1024 ** 3
    : null;
  const vramRatio = availableVramGiB
    ? (estimatedVramGiB / availableVramGiB) * 100
    : null;
  const speedFactor =
    availableVramGiB === null
      ? 1
      : availableVramGiB >= 24
        ? 0.55
        : availableVramGiB >= 16
          ? 0.8
          : availableVramGiB >= 12
            ? 1.15
            : 1.65;
  const secondsPerJob =
    (input.trainingSteps * 0.32 +
      input.samplingSteps * megapixels * 0.42 +
      (input.upscaleEnabled
        ? input.upscaleSteps *
          megapixels *
          upscaleScale *
          upscaleScale *
          0.5
        : 0)) *
    speedFactor;
  const totalSeconds = secondsPerJob * jobCount;
  const lowerSeconds = totalSeconds * 0.7;
  const upperSeconds = totalSeconds * 1.5;
  const baseOutputs = batchSize * jobCount;
  const upscaleOutputs = input.upscaleEnabled ? baseOutputs : 0;
  const totalOutputCount = baseOutputs + upscaleOutputs;
  const totalOutputMegapixels =
    megapixels * baseOutputs +
    (input.upscaleEnabled
      ? megapixels * upscaleScale * upscaleScale * upscaleOutputs
      : 0);

  const highReasons = [
    vramRatio !== null && vramRatio > 90
      ? "추정 VRAM이 사용 가능한 용량의 90%를 초과합니다."
      : "",
    totalOutputCount > 8
      ? `총 출력이 ${totalOutputCount}장입니다.`
      : "",
    totalOutputMegapixels > 16
      ? `총 출력 면적이 ${totalOutputMegapixels.toFixed(1)}MP입니다.`
      : "",
    upperSeconds > 30 * 60
      ? "예상 총 소요 시간 상한이 30분을 넘습니다."
      : "",
  ].filter(Boolean);
  const cautionReasons = [
    vramRatio !== null && vramRatio > 75
      ? "추정 VRAM 사용량이 높습니다."
      : "",
    totalOutputCount > 4 ? "한 번에 여러 결과를 생성합니다." : "",
    totalOutputMegapixels > 8 ? "총 출력 면적이 큽니다." : "",
    upperSeconds > 10 * 60 ? "예상 총 소요 시간이 10분을 넘을 수 있습니다." : "",
  ].filter(Boolean);

  return {
    megapixels,
    estimatedVramGiB,
    availableVramGiB,
    vramRatio,
    lowerSeconds,
    upperSeconds,
    totalOutputCount,
    totalOutputMegapixels,
    jobCount,
    risk: highReasons.length
      ? "high"
      : cautionReasons.length
        ? "caution"
        : "normal",
    reasons: highReasons.length ? highReasons : cautionReasons,
  };
}

function profileSnapshot(draft: GenerationDraft) {
  return {
    referenceAssetIds: draft.referenceAssets.map((asset) => asset.id),
    prompts: draft.prompts,
    instantLora: draft.instantLora,
    tagging: draft.tagging,
  };
}

function modelPackSnapshot(draft: GenerationDraft) {
  return {
    models: draft.models,
    loras: draft.loras.map((lora) => ({
      id: lora.id,
      name: lora.name,
      path: lora.path,
      enabled: lora.enabled,
      modelStrength: lora.modelStrength,
      clipStrength: lora.clipStrength,
      triggerWords: lora.triggerWords,
    })),
  };
}

export function isCharacterProfileDirty(
  draft: GenerationDraft,
  profile: CharacterProfile | undefined,
) {
  if (!profile) return false;
  return (
    JSON.stringify(profileSnapshot(draft)) !==
    JSON.stringify(profileSnapshot(profile.draft))
  );
}

export function isModelPackDirty(
  draft: GenerationDraft,
  pack: ModelPack | undefined,
) {
  if (!pack) return false;
  return (
    JSON.stringify(modelPackSnapshot(draft)) !==
    JSON.stringify({
      models: pack.models,
      loras: pack.loras.map((lora) => ({
        id: lora.id,
        name: lora.name,
        path: lora.path,
        enabled: lora.enabled,
        modelStrength: lora.modelStrength,
        clipStrength: lora.clipStrength,
        triggerWords: lora.triggerWords,
      })),
    })
  );
}
