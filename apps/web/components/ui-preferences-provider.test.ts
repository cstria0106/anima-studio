import { describe, expect, test } from "bun:test";
import { DEFAULT_DRAFT } from "@/lib/types";
import {
  loadUiPreferencesWithStartupRetry,
  normalizeGlobalUpscaleSettings,
  normalizeGenerationDraft,
  resolveGlobalUpscaleSettings,
} from "./ui-preferences-provider";
import { ApiError } from "@/lib/api";

describe("normalizeGenerationDraft", () => {
  test("restores saved fields while filling new fields from defaults", () => {
    const draft = normalizeGenerationDraft({
      prompts: { positive: "red eyes" },
      sampling: { steps: 42 },
      loraOptimizer: { enabled: false },
    });

    expect(draft.prompts.positive).toBe("red eyes");
    expect(draft.prompts.baseNegative).toBe(
      DEFAULT_DRAFT.prompts.baseNegative,
    );
    expect(draft.sampling.steps).toBe(42);
    expect(draft.sampling.scheduler).toBe(DEFAULT_DRAFT.sampling.scheduler);
    expect(draft.loraOptimizer.enabled).toBeFalse();
  });

  test("drops transient references and clears legacy model selections", () => {
    const draft = normalizeGenerationDraft(
      {
        models: { diffusion: "model.safetensors" },
        loras: [{ id: "lora", path: "lora.safetensors" }],
        referenceAssets: [
          { id: "uploading", status: "uploading", url: "blob:upload" },
          { id: "blob", status: "ready", url: "blob:ready" },
          { id: "saved", status: "ready", url: "/api/assets/saved" },
        ],
      },
      true,
    );

    expect(draft.models.diffusion).toBe("");
    expect(draft.loras).toEqual([]);
    expect(draft.referenceAssets.map((asset) => asset.id)).toEqual(["saved"]);
    expect(draft.loraOptimizer.enabled).toBeTrue();
  });
});

describe("UI preference startup loading", () => {
  test("retries a startup response until persisted preferences are available", async () => {
    const controller = new AbortController();
    const draft = structuredClone(DEFAULT_DRAFT);
    draft.prompts.positive = "restored";
    const saved = { draft };
    let attempts = 0;

    const preferences = await loadUiPreferencesWithStartupRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ApiError("Anima Studio is starting.", 503);
        return saved;
      },
      controller.signal,
      async () => {},
    );

    expect(attempts).toBe(3);
    expect(preferences).toBe(saved);
  });

  test("does not retry a non-startup failure", async () => {
    const controller = new AbortController();
    let attempts = 0;

    await expect(
      loadUiPreferencesWithStartupRetry(
        async () => {
          attempts += 1;
          throw new ApiError("Failed", 500);
        },
        controller.signal,
        async () => {},
      ),
    ).rejects.toMatchObject({ status: 500 });
    expect(attempts).toBe(1);
  });
});

describe("global upscale settings", () => {
  test("fills seed defaults in legacy global settings", () => {
    expect(
      normalizeGlobalUpscaleSettings({
        method: "bilinear",
        scale: 1.5,
        steps: 30,
        denoise: 0.8,
      }),
    ).toMatchObject({ seed: { mode: "source", value: 42 } });
  });

  test("falls back to the saved generation draft until a global value exists", () => {
    const draft = structuredClone(DEFAULT_DRAFT);
    draft.upscale = {
      enabled: true,
      method: "bicubic",
      scale: 2,
      steps: 18,
      denoise: 0.45,
    };

    expect(resolveGlobalUpscaleSettings({ draft })).toEqual({
      method: "bicubic",
      scale: 2,
      steps: 18,
      denoise: 0.45,
      seed: { mode: "source", value: 42 },
    });
  });

  test("prefers the independently saved global value", () => {
    expect(
      resolveGlobalUpscaleSettings({
        draft: DEFAULT_DRAFT,
        upscaleSettings: {
          method: "area",
          scale: 1.75,
          steps: 20,
          denoise: 0.3,
          seed: { mode: "fixed", value: 9876 },
        },
      }),
    ).toEqual({
      method: "area",
      scale: 1.75,
      steps: 20,
      denoise: 0.3,
      seed: { mode: "fixed", value: 9876 },
    });
  });
});
