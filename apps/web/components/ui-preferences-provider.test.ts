import { describe, expect, test } from "bun:test";
import { DEFAULT_DRAFT } from "@/lib/types";
import { normalizeGenerationDraft } from "./ui-preferences-provider";

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
