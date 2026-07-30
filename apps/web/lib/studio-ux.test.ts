import { describe, expect, test } from "bun:test";
import {
  buildPreflightIssues,
  clearModelAndLoraSelections,
  estimateWorkload,
  isCharacterProfileDirty,
  isModelPackDirty,
} from "./studio-ux";
import {
  DEFAULT_DRAFT,
  EMPTY_OPTIONS,
  type CharacterProfile,
  type ModelPack,
  type RuntimeHardware,
} from "./types";

const readyDraft = {
  ...structuredClone(DEFAULT_DRAFT),
  referenceAssets: [
    {
      id: "asset-1",
      name: "reference.png",
      url: "/api/assets/asset-1",
      status: "ready" as const,
    },
  ],
  models: {
    diffusion: "anima.safetensors",
    clip: "clip.safetensors",
    vae: "vae.safetensors",
  },
};

const options = {
  ...EMPTY_OPTIONS,
  diffusionModels: [
    { name: "Anima", value: "anima.safetensors" },
  ],
  clips: [{ name: "CLIP", value: "clip.safetensors" }],
  vaes: [{ name: "VAE", value: "vae.safetensors" }],
};

const hardware: RuntimeHardware = {
  platform: "win32",
  architecture: "x64",
  supported: true,
  gpuName: "Test GPU",
  driverVersion: null,
  vramBytes: 16 * 1024 ** 3,
  freeDiskBytes: null,
  warnings: [],
};

describe("studio UX readiness", () => {
  test("maps each missing input to the step and field that can resolve it", () => {
    const issues = buildPreflightIssues({
      draft: structuredClone(DEFAULT_DRAFT),
      options: EMPTY_OPTIONS,
      optionsLoading: false,
      health: { ok: true, comfyui: true },
      capabilities: null,
    });

    expect(issues.map((issue) => [issue.code, issue.stepId, issue.fieldId])).toEqual([
      ["reference_missing", "reference", undefined],
      ["diffusion_required", "models", "diffusion-model"],
      ["clip_required", "models", "clip-model"],
      ["vae_required", "models", "vae-model"],
    ]);
  });

  test("reports no blocking issue for the default portable setup once resources exist", () => {
    const issues = buildPreflightIssues({
      draft: readyDraft,
      options,
      optionsLoading: false,
      health: { ok: true, comfyui: true },
      capabilities: { ready: true, missingNodes: [] },
    });

    expect(issues).toEqual([]);
  });
});

describe("draft model defaults", () => {
  test("clears model and LoRA selections without discarding the rest of the draft", () => {
    const draft = structuredClone(readyDraft);
    draft.loras = [
      {
        id: "lora-1",
        name: "LoRA",
        path: "lora.safetensors",
        enabled: true,
        modelStrength: 1,
        clipStrength: 1,
        triggerWords: [],
      },
    ];
    draft.prompts.positive = "1girl";
    draft.sampling.steps = 42;

    const cleared = clearModelAndLoraSelections(draft);

    expect(cleared.models).toEqual({ diffusion: "", clip: "", vae: "" });
    expect(cleared.loras).toEqual([]);
    expect(cleared.prompts.positive).toBe("1girl");
    expect(cleared.referenceAssets).toEqual(draft.referenceAssets);
    expect(cleared.sampling.steps).toBe(42);
  });
});

describe("workload estimate", () => {
  test("keeps the default generation below the confirmation threshold", () => {
    const estimate = estimateWorkload(
      {
        width: 704,
        height: 1408,
        batchSize: 1,
        trainingSteps: 200,
        samplingSteps: 30,
        upscaleSteps: 0,
        upscaleScale: 1.5,
        referenceCount: 3,
        upscaleEnabled: false,
      },
      hardware,
    );

    expect(estimate.risk).toBe("normal");
    expect(estimate.totalOutputCount).toBe(1);
  });

  test("marks large variation batches high risk and accounts for every output", () => {
    const estimate = estimateWorkload(
      {
        width: 1024,
        height: 1024,
        batchSize: 1,
        trainingSteps: 200,
        samplingSteps: 30,
        upscaleSteps: 30,
        upscaleScale: 1.5,
        referenceCount: 3,
        upscaleEnabled: true,
        jobCount: 8,
      },
      hardware,
    );

    expect(estimate.risk).toBe("high");
    expect(estimate.totalOutputCount).toBe(16);
    expect(estimate.totalOutputMegapixels).toBeGreaterThan(16);
  });
});

describe("preset dirty state", () => {
  test("ignores sampling changes when comparing a model pack", () => {
    const pack: ModelPack = {
      id: "pack-1",
      name: "Pack",
      models: structuredClone(readyDraft.models),
      loras: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const changed = structuredClone(readyDraft);
    changed.sampling.steps = 50;

    expect(isModelPackDirty(changed, pack)).toBe(false);
  });

  test("detects character prompt changes without treating model changes as profile edits", () => {
    const profile: CharacterProfile = {
      id: "profile-1",
      name: "Character",
      draft: structuredClone(readyDraft),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const modelOnly = structuredClone(readyDraft);
    modelOnly.models.diffusion = "another.safetensors";
    const promptChange = structuredClone(readyDraft);
    promptChange.prompts.positive = "1girl";

    expect(isCharacterProfileDirty(modelOnly, profile)).toBe(false);
    expect(isCharacterProfileDirty(promptChange, profile)).toBe(true);
  });
});
