import { describe, expect, test } from "bun:test";
import {
  buildPreflightIssues,
  clearModelAndLoraSelections,
  loadSeedIntoDraft,
  restoreImageSettings,
} from "./studio-ux";
import {
  emptyInpaintWorkspace,
  inpaintWorkspaceFromOutput,
} from "./inpaint";
import { DEFAULT_DRAFT, EMPTY_OPTIONS } from "./types";

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

  test("allows generation without a reference image", () => {
    const issues = buildPreflightIssues({
      draft: { ...readyDraft, referenceAssets: [] },
      options,
      optionsLoading: false,
      health: { ok: true, comfyui: true },
      capabilities: { ready: true, missingNodes: [] },
    });

    expect(issues).toEqual([]);
  });

  test("requires a saved mask and inpaint capability only while the card is active", () => {
    const output = { id: "output-1", kind: "base", width: 512, height: 768 };
    const job = {
      settings: structuredClone(readyDraft),
    } as Parameters<typeof inpaintWorkspaceFromOutput>[0];
    const inpaint = inpaintWorkspaceFromOutput(job, output);
    const issues = buildPreflightIssues({
      draft: readyDraft,
      options,
      optionsLoading: false,
      health: { ok: true, comfyui: true },
      capabilities: { ready: true, missingNodes: [] },
      inpaint,
      inpaintCapabilities: null,
    });

    expect(issues.map((issue) => [issue.code, issue.stepId])).toEqual([
      ["inpaint_capabilities_missing", "inpaint"],
      ["inpaint_mask_required", "inpaint"],
    ]);
    expect(
      buildPreflightIssues({
        draft: readyDraft,
        options,
        optionsLoading: false,
        health: { ok: true, comfyui: true },
        capabilities: { ready: true, missingNodes: [] },
        inpaint: emptyInpaintWorkspace(),
        inpaintCapabilities: null,
      }),
    ).toEqual([]);
  });

  test("blocks generation while an inpaint source is being prepared", () => {
    const issues = buildPreflightIssues({
      draft: readyDraft,
      options,
      optionsLoading: false,
      health: { ok: true, comfyui: true },
      capabilities: { ready: true, missingNodes: [] },
      inpaint: {
        ...emptyInpaintWorkspace(),
        sourceStatus: "uploading",
      },
      inpaintCapabilities: { ready: true, missingNodes: [] },
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      "inpaint_source_uploading",
    ]);
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
        useTriggerWords: true,
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

describe("seed loading", () => {
  test("loads only the selected job seed and fixes the seed mode", () => {
    const draft = structuredClone(readyDraft);
    draft.sampling.seedMode = "random";
    draft.sampling.seed = 42;

    const loaded = loadSeedIntoDraft(draft, 9_876_543);

    expect(loaded.sampling.seedMode).toBe("fixed");
    expect(loaded.sampling.seed).toBe(9_876_543);
    expect(loaded.prompts).toEqual(draft.prompts);
    expect(loaded.models).toEqual(draft.models);
    expect(loaded.referenceAssets).toEqual(draft.referenceAssets);
  });
});

describe("image settings restoration", () => {
  const job = {
    id: "job-1",
    status: "completed" as const,
    createdAt: "2026-08-04T00:00:00.000Z",
    settings: {
      ...structuredClone(readyDraft),
      upscale: {
        enabled: true,
        method: "bicubic",
        scale: 2,
        steps: 18,
        denoise: 0.45,
      },
    },
    outputs: [
      { id: "base-1", kind: "base" },
      { id: "upscale-1", kind: "upscale" },
    ],
  };
  const globalUpscale = {
    method: "area" as const,
    scale: 1.75,
    steps: 22,
    denoise: 0.35,
    seed: { mode: "source" as const, value: 42 },
  };

  test("disables upscale and applies global fields for a base image", () => {
    const restored = restoreImageSettings(job, "base-1", globalUpscale);

    expect(restored.upscale).toEqual({
      method: globalUpscale.method,
      scale: globalUpscale.scale,
      steps: globalUpscale.steps,
      denoise: globalUpscale.denoise,
      enabled: false,
    });
    expect(job.settings.upscale).toEqual({
      enabled: true,
      method: "bicubic",
      scale: 2,
      steps: 18,
      denoise: 0.45,
    });
  });

  test("restores and enables the settings used by an upscale image", () => {
    const restored = restoreImageSettings(job, "upscale-1", globalUpscale);

    expect(restored.upscale).toEqual(job.settings.upscale);
    expect(restored.upscale.enabled).toBeTrue();
  });

  test("rejects an output that does not belong to the job", () => {
    expect(() =>
      restoreImageSettings(job, "missing", globalUpscale),
    ).toThrow("선택한 이미지의 생성 설정을 찾지 못했습니다.");
  });
});
