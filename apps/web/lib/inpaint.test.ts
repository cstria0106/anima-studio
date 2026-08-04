import { describe, expect, test } from "bun:test";
import {
  centeredInpaintCrop,
  emptyInpaintWorkspace,
  inpaintWorkspaceFromJob,
  inpaintWorkspaceFromOutput,
  initialInpaintDraft,
  maskHasPaint,
  preparedInpaintSubmission,
  reduceMaskHistory,
} from "./inpaint";
import { DEFAULT_DRAFT, type StudioJob } from "./types";

describe("inpaint image preparation", () => {
  test("center-crops only the remainder needed for dimensions divisible by eight", () => {
    expect(centeredInpaintCrop(1027, 1001)).toEqual({
      sourceWidth: 1027,
      sourceHeight: 1001,
      width: 1024,
      height: 1000,
      x: 1,
      y: 0,
      cropped: true,
    });
    expect(centeredInpaintCrop(768, 1024).cropped).toBeFalse();
  });

  test("tracks drawing, erasing, clear, and invert snapshots through undo and redo", () => {
    let state = { past: [] as string[], present: "empty", future: [] as string[] };
    state = reduceMaskHistory(state, { type: "commit", value: "drawn" });
    state = reduceMaskHistory(state, { type: "commit", value: "erased" });
    state = reduceMaskHistory(state, { type: "commit", value: "cleared" });
    state = reduceMaskHistory(state, { type: "commit", value: "inverted" });
    expect(state.present).toBe("inverted");

    state = reduceMaskHistory(state, { type: "undo" });
    expect(state.present).toBe("cleared");
    state = reduceMaskHistory(state, { type: "redo" });
    expect(state.present).toBe("inverted");
  });

  test("detects an empty alpha mask", () => {
    expect(maskHasPaint(new Uint8ClampedArray([0, 0, 0, 0]))).toBeFalse();
    expect(maskHasPaint(new Uint8ClampedArray([0, 0, 0, 1]))).toBeTrue();
  });

  test("inherits output settings but uses the current draft for a file source", () => {
    const current = structuredClone(DEFAULT_DRAFT);
    current.prompts.positive = "current draft";
    current.upscale.enabled = true;
    const outputSettings = structuredClone(DEFAULT_DRAFT);
    outputSettings.prompts.positive = "source output";
    outputSettings.sampling.seedMode = "fixed";
    outputSettings.sampling.seed = 9876;
    outputSettings.upscale.enabled = true;
    const sourceJob = { settings: outputSettings } as StudioJob;

    expect(initialInpaintDraft(current).prompts.positive).toBe("current draft");
    expect(initialInpaintDraft(current).upscale.enabled).toBeFalse();
    expect(initialInpaintDraft(current, sourceJob)).toMatchObject({
      prompts: { positive: "source output" },
      sampling: { seedMode: "fixed", seed: 9876 },
      upscale: { enabled: false },
    });
  });

  test("starts a fresh inpaint workspace from the selected output", () => {
    const output = { id: "base-output", kind: "base", width: 768, height: 1024 };
    const job = {
      id: "generation-job",
      kind: "generation",
      settings: structuredClone(DEFAULT_DRAFT),
    } as StudioJob;

    const workspace = inpaintWorkspaceFromOutput(job, output);

    expect(workspace).toMatchObject({
      source: { type: "output", output, crop: { width: 768, height: 1024 } },
      sourceStatus: "ready",
      maskAsset: null,
      growMaskBy: 6,
    });
    expect(workspace.revisionOfJobId).toBeUndefined();
  });

  test("restores the exact input source, mask, and lineage from an inpaint job", () => {
    const inputSourceAsset = {
      id: "input-source",
      name: "input.png",
      url: "/api/assets/input-source",
      width: 768,
      height: 1024,
      status: "ready" as const,
    };
    const maskAsset = {
      id: "mask-asset",
      name: "mask.png",
      url: "/api/assets/mask-asset",
      status: "ready" as const,
    };
    const rootSourceAsset = {
      ...inputSourceAsset,
      id: "root-source",
      name: "root.png",
      url: "/api/assets/root-source",
    };
    const job = {
      id: "inpaint-job",
      kind: "inpaint",
      settings: structuredClone(DEFAULT_DRAFT),
      inpaint: {
        inputSourceAsset,
        rootSourceAsset,
        maskAsset,
        growMaskBy: 13,
      },
    } as StudioJob;

    const workspace = inpaintWorkspaceFromJob(job);

    expect(workspace).toMatchObject({
      source: {
        type: "asset",
        asset: inputSourceAsset,
        crop: { width: 768, height: 1024 },
      },
      sourceStatus: "ready",
      maskAsset,
      growMaskBy: 13,
      revisionOfJobId: "inpaint-job",
    });
    expect(preparedInpaintSubmission(workspace)).toEqual({
      source: { type: "asset", assetId: "input-source" },
      maskAssetId: "mask-asset",
      growMaskBy: 13,
      revisionOfJobId: "inpaint-job",
    });
  });

  test("requires a saved mask before preparing an inpaint submission", () => {
    expect(() => preparedInpaintSubmission(emptyInpaintWorkspace())).toThrow(
      "인페인트 원본과 저장된 마스크",
    );
  });

  test("prepares an uploaded asset source without revision lineage", () => {
    const workspace = {
      source: {
        type: "asset" as const,
        asset: {
          id: "source-asset",
          name: "source.png",
          url: "/api/assets/source-asset",
          status: "ready" as const,
        },
        crop: centeredInpaintCrop(512, 768),
      },
      sourceStatus: "ready" as const,
      maskAsset: {
        id: "mask-asset",
        name: "mask.png",
        url: "/api/assets/mask-asset",
        status: "ready" as const,
      },
      growMaskBy: 6,
    };

    expect(preparedInpaintSubmission(workspace)).toEqual({
      source: { type: "asset", assetId: "source-asset" },
      maskAssetId: "mask-asset",
      growMaskBy: 6,
      revisionOfJobId: undefined,
    });
  });
});
