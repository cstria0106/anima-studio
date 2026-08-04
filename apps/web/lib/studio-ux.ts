import type {
  CapabilitiesResponse,
  GenerationDraft,
  GlobalUpscaleSettings,
  HealthResponse,
  StudioJob,
  StudioOptions,
} from "@/lib/types";
import type { InpaintWorkspaceDraft } from "@/lib/inpaint";

export type CreateStepId =
  | "reference"
  | "inpaint"
  | "prompt"
  | "models"
  | "generation";

export interface PreflightIssue {
  code:
    | "comfy_offline"
    | "capabilities_missing"
    | "options_loading"
    | "reference_uploading"
    | "inpaint_source_uploading"
    | "inpaint_source_error"
    | "inpaint_mask_required"
    | "inpaint_capabilities_missing"
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

interface PreflightInput {
  draft: GenerationDraft;
  options: StudioOptions;
  optionsLoading: boolean;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  inpaint?: InpaintWorkspaceDraft;
  inpaintCapabilities?: CapabilitiesResponse | null;
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

export function loadSeedIntoDraft(
  draft: GenerationDraft,
  seed: number,
): GenerationDraft {
  return {
    ...draft,
    sampling: {
      ...draft.sampling,
      seedMode: "fixed",
      seed,
    },
  };
}

export function restoreImageSettings(
  job: StudioJob,
  outputId: string,
  globalUpscaleSettings: GlobalUpscaleSettings,
): GenerationDraft {
  const output = job.outputs.find((item) => item.id === outputId);
  if (!output) {
    throw new Error("선택한 이미지의 생성 설정을 찾지 못했습니다.");
  }

  const restored = structuredClone(job.settings);
  restored.upscale =
    output.kind === "upscale" || output.kind === "upscaled"
      ? { ...restored.upscale, enabled: true }
      : { ...globalUpscaleSettings, enabled: false };
  return restored;
}

export function buildPreflightIssues({
  draft,
  options,
  optionsLoading,
  health,
  capabilities,
  inpaint,
  inpaintCapabilities,
}: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const inpaintActive = Boolean(
    inpaint && (inpaint.source !== null || inpaint.sourceStatus !== "idle"),
  );
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
  const activeCapabilities = inpaintActive ? inpaintCapabilities : capabilities;
  if (activeCapabilities && !activeCapabilities.ready) {
    issues.push({
      code: inpaintActive
        ? "inpaint_capabilities_missing"
        : "capabilities_missing",
      message: inpaintActive
        ? "연결된 ComfyUI가 인페인트 코어 노드를 지원하지 않습니다."
        : "필수 노드 또는 모델을 먼저 설치해주세요.",
      stepId: inpaintActive ? "inpaint" : "models",
      severity: "error",
    });
  } else if (inpaintActive && !activeCapabilities) {
    issues.push({
      code: "inpaint_capabilities_missing",
      message: "인페인트 지원 여부를 확인하고 있습니다.",
      stepId: "inpaint",
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

  if (draft.referenceAssets.some((asset) => asset.status === "uploading")) {
    issues.push({
      code: "reference_uploading",
      message: "참조 이미지 업로드가 끝날 때까지 기다려주세요.",
      stepId: "reference",
      severity: "error",
    });
  }

  if (
    inpaintActive &&
    (inpaint?.sourceStatus === "preparing" ||
      inpaint?.sourceStatus === "uploading")
  ) {
    issues.push({
      code: "inpaint_source_uploading",
      message: "인페인트 원본 준비가 끝날 때까지 기다려주세요.",
      stepId: "inpaint",
      severity: "error",
    });
  }
  if (inpaintActive && inpaint?.sourceStatus === "error") {
    issues.push({
      code: "inpaint_source_error",
      message: inpaint.sourceError ?? "인페인트 원본을 다시 선택해주세요.",
      stepId: "inpaint",
      severity: "error",
    });
  }
  if (
    inpaintActive &&
    inpaint?.sourceStatus === "ready" &&
    !inpaint.maskAsset
  ) {
    issues.push({
      code: "inpaint_mask_required",
      message: "마스크 편집에서 수정할 영역을 저장해주세요.",
      stepId: "inpaint",
      fieldId: "inpaint-mask-edit",
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
