import type {
  CapabilitiesResponse,
  GenerationDraft,
  HealthResponse,
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
