import { describe, expect, test } from "bun:test";
import type { GenerationConfig } from "@anima/shared";

import {
  buildUpscaleWorkflow,
  buildWorkflow,
  loraLoaderNodeId,
  NODE_IDS,
  referenceBatchNodeId,
  referenceLoadNodeId,
} from "../src";

function makeConfig(
  overrides: Partial<GenerationConfig> = {},
): GenerationConfig {
  return {
    referenceAssetIds: ["asset-a", "asset-b", "asset-c"],
    prompts: {
      basePositive:
        "newest, masterpiece, very aesthetic, score_7, best quality",
      positive: "",
      baseNegative:
        "worst quality, low quality, score_1, score_2, score_3",
      negative: "",
    },
    model: {
      diffusionModel: "anima.safetensors",
      clip: "qwen-clip.safetensors",
      clipType: "stable_diffusion",
      vae: "qwen-vae.safetensors",
      weightDtype: "default",
    },
    loras: [],
    instantLora: {
      profile: "anima",
      modelStrength: 0.7,
      clipStrength: 0.7,
      tagging: {
        generalThreshold: 0.35,
        characterThreshold: 0.7,
        prependTags: "",
        appendTags: "vrcg",
        excludeTags: "",
        replaceTags: "",
        removeUnderscore: true,
      },
      training: {
        steps: 200,
        learningRate: 0.001,
        networkDim: 16,
        networkAlpha: 1,
        resolution: "",
        gradientCheckpointing: true,
        cacheLatents: true,
        cacheTextEncoderOutputs: true,
        seed: 42,
        forceRetrain: false,
        batchSize: 0,
      },
    },
    seed: { mode: "fixed", value: 123456 },
    sampling: {
      sampler: "er_sde",
      scheduler: "sgm_uniform",
      steps: 30,
      denoise: 1,
      cfg: 5,
      cfgStart: 0,
      cfgEnd: 1,
    },
    image: {
      width: 704,
      height: 1408,
      batchSize: 1,
      preset: "1:2 - 704x1408",
    },
    upscale: {
      enabled: false,
      method: "bilinear",
      scale: 1.5,
      steps: 30,
      denoise: 0.7,
    },
    ...overrides,
  };
}

describe("buildWorkflow", () => {
  test("builds a history-independent base prompt with direct seed and prompt text", () => {
    const config = makeConfig({
      prompts: {
        basePositive: "quality",
        positive: "character",
        baseNegative: "bad quality",
        negative: "artifact",
      },
    });

    const result = buildWorkflow(config, [
      "anima-studio/a.png",
      "anima-studio/b.png",
      "anima-studio/c.png",
    ]);

    expect(result.actualSeed).toBe(123456);
    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.text).toBe(
      "quality\ncharacter",
    );
    expect(result.prompt[NODE_IDS.negativeEncode]?.inputs.text).toBe(
      "bad quality\nartifact",
    );
    expect(result.prompt[NODE_IDS.baseNoise]?.inputs.noise_seed).toBe(123456);
    expect(
      Object.values(result.prompt).some(
        (node) => node.class_type === "Seed (rgthree)",
      ),
    ).toBeFalse();
    expect(
      Object.values(result.prompt).some(
        (node) => node.class_type === "JoinStringMulti",
      ),
    ).toBeFalse();
    expect(result.prompt[result.autoTagsNodeId!]).toEqual({
      class_type: "SaveText",
      inputs: {
        text: [NODE_IDS.instantReference, 4],
        filename_prefix: "AnimaStudio/tags",
        format: "txt",
      },
    });
  });

  test("preserves prompt field text and duplicate tags exactly", () => {
    const config = makeConfig({
      prompts: {
        basePositive: "  quality, quality  ",
        positive: "character, character, ",
        baseNegative: "",
        negative: "artifact, artifact, ",
      },
    });

    const result = buildWorkflow(config, [
      "anima-studio/reference-a.png",
      "anima-studio/reference-b.png",
      "anima-studio/reference-c.png",
    ]);

    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.text).toBe(
      "  quality, quality  \ncharacter, character, ",
    );
    expect(result.prompt[NODE_IDS.negativeEncode]?.inputs.text).toBe(
      "artifact, artifact, ",
    );
  });

  test("treats tag prompt line breaks as commas only in the built prompt", () => {
    const config = makeConfig({
      prompts: {
        basePositive: "quality",
        positive: "character\nred eyes\r\nlong hair",
        baseNegative: "bad quality",
        negative: "artifact\rblurry",
      },
    });

    const result = buildWorkflow(config, [
      "anima-studio/reference-a.png",
      "anima-studio/reference-b.png",
      "anima-studio/reference-c.png",
    ]);

    expect(config.prompts.positive).toBe("character\nred eyes\r\nlong hair");
    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.text).toBe(
      "quality\ncharacter,red eyes,long hair",
    );
    expect(result.prompt[NODE_IDS.negativeEncode]?.inputs.text).toBe(
      "bad quality\nartifact,blurry",
    );
  });

  test("excludes line comments from tag prompts", () => {
    const config = makeConfig({
      prompts: {
        basePositive: "quality",
        positive: "character, // try blue hair later\nred eyes // keep this",
        baseNegative: "bad quality",
        negative: "artifact // generated hands",
      },
    });

    const result = buildWorkflow(config, [
      "anima-studio/reference-a.png",
      "anima-studio/reference-b.png",
      "anima-studio/reference-c.png",
    ]);

    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.text).toBe(
      "quality\ncharacter, ,red eyes ",
    );
    expect(result.prompt[NODE_IDS.negativeEncode]?.inputs.text).toBe(
      "bad quality\nartifact ",
    );
  });

  test("uses core LoadImage and ImageBatch nodes in reference order", () => {
    const result = buildWorkflow(makeConfig(), [
      "refs/first.png",
      "refs/second.png",
      "refs/third.png",
    ]);

    expect(result.prompt[referenceLoadNodeId(0)]).toEqual({
      class_type: "LoadImage",
      inputs: { image: "refs/first.png" },
    });
    expect(result.prompt[referenceBatchNodeId(0)]?.inputs).toEqual({
      image1: [referenceLoadNodeId(0), 0],
      image2: [referenceLoadNodeId(1), 0],
    });
    expect(result.prompt[referenceBatchNodeId(1)]?.inputs).toEqual({
      image1: [referenceBatchNodeId(0), 0],
      image2: [referenceLoadNodeId(2), 0],
    });
    expect(result.prompt[NODE_IDS.instantReference]?.inputs.images).toEqual([
      referenceBatchNodeId(1),
      0,
    ]);
  });

  test("temporarily disables Instant Reference when there are no reference images", () => {
    const result = buildWorkflow(
      makeConfig({ referenceAssetIds: [] }),
      [],
    );

    expect(result.prompt[NODE_IDS.trainOptions]).toBeUndefined();
    expect(result.prompt[NODE_IDS.taggingOptions]).toBeUndefined();
    expect(result.prompt[NODE_IDS.instantReference]).toBeUndefined();
    expect(result.prompt[NODE_IDS.loraOptimizer]).toBeUndefined();
    expect(result.prompt[NODE_IDS.autoTagsSave]).toBeUndefined();
    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.clip).toEqual([
      NODE_IDS.clipLoader,
      0,
    ]);
    expect(result.prompt[NODE_IDS.cfgGuidance]?.inputs.model).toEqual([
      NODE_IDS.modelLoader,
      0,
    ]);
    expect(result.autoTagsNodeId).toBeNull();
    expect(result.autoTagsSource).toBeNull();
  });

  test("applies InstantReference through the optimizer, then chains enabled LoRAs", () => {
    const config = makeConfig({
      loras: [
        {
          name: "style-a",
          modelStrength: 0.3,
          clipStrength: 0.3,
          enabled: true,
          triggerWords: [],
          useTriggerWords: true,
        },
        {
          name: "style-b",
          modelStrength: 0.8,
          clipStrength: 0.6,
          enabled: true,
          triggerWords: [],
          useTriggerWords: true,
        },
        {
          name: "disabled",
          modelStrength: 1,
          clipStrength: 1,
          enabled: false,
          triggerWords: [],
          useTriggerWords: true,
        },
      ],
    });

    const result = buildWorkflow(config, [
      "a.png",
      "b.png",
      "c.png",
    ]);
    expect(result.prompt[NODE_IDS.loraOptimizer]?.inputs.lora_stack).toEqual([
      NODE_IDS.instantReference,
      3,
    ]);
    expect(result.prompt[loraLoaderNodeId(0)]).toEqual({
      class_type: "LoraLoader",
      inputs: {
        model: [NODE_IDS.loraOptimizer, 0],
        clip: [NODE_IDS.loraOptimizer, 1],
        lora_name: "style-a",
        strength_model: 0.3,
        strength_clip: 0.3,
      },
    });
    expect(result.prompt[loraLoaderNodeId(1)]).toEqual({
      class_type: "LoraLoader",
      inputs: {
        model: [loraLoaderNodeId(0), 0],
        clip: [loraLoaderNodeId(0), 1],
        lora_name: "style-b",
        strength_model: 0.8,
        strength_clip: 0.6,
      },
    });
    expect(result.prompt[loraLoaderNodeId(2)]).toBeUndefined();
    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.clip).toEqual([
      loraLoaderNodeId(1),
      1,
    ]);
    expect(result.prompt[NODE_IDS.cfgGuidance]?.inputs.model).toEqual([
      loraLoaderNodeId(1),
      0,
    ]);
  });

  test("inserts only enabled LoRA trigger words into the generated positive prompt", () => {
    const config = makeConfig({
      prompts: {
        basePositive: "quality",
        positive: "character",
        baseNegative: "",
        negative: "",
      },
      loras: [
        {
          name: "keywords-on",
          modelStrength: 1,
          clipStrength: 1,
          enabled: true,
          triggerWords: ["red dress", "long hair"],
          useTriggerWords: true,
        },
        {
          name: "keywords-off",
          modelStrength: 1,
          clipStrength: 1,
          enabled: true,
          triggerWords: ["not inserted"],
          useTriggerWords: false,
        },
        {
          name: "lora-off",
          modelStrength: 1,
          clipStrength: 1,
          enabled: false,
          triggerWords: ["also not inserted"],
          useTriggerWords: true,
        },
      ],
    });

    const result = buildWorkflow(config, ["a.png", "b.png", "c.png"]);

    expect(result.prompt[NODE_IDS.positiveEncode]?.inputs.text).toBe(
      "quality\ncharacter\nred dress, long hair",
    );
  });

  test("maps model, training, tagging, sampling, CFG, and image settings", () => {
    const config = makeConfig();
    const result = buildWorkflow(config, ["a.png", "b.png", "c.png"]);

    expect(result.prompt[NODE_IDS.modelLoader]?.inputs.unet_name).toBe(
      config.model.diffusionModel,
    );
    expect(result.prompt[NODE_IDS.clipLoader]?.inputs.clip_name).toBe(
      config.model.clip,
    );
    expect(result.prompt[NODE_IDS.vaeLoader]?.inputs.vae_name).toBe(
      config.model.vae,
    );
    expect(result.prompt[NODE_IDS.trainOptions]?.inputs.steps_override).toBe(
      config.instantLora.training.steps,
    );
    expect(
      result.prompt[NODE_IDS.taggingOptions]?.inputs.general_threshold,
    ).toBe(config.instantLora.tagging.generalThreshold);
    expect(result.prompt[NODE_IDS.cfgGuidance]?.inputs).toMatchObject({
      cfg: config.sampling.cfg,
      start_percent: config.sampling.cfgStart,
      end_percent: config.sampling.cfgEnd,
    });
    expect(result.prompt[NODE_IDS.baseScheduler]?.inputs).toMatchObject({
      scheduler: config.sampling.scheduler,
      steps: config.sampling.steps,
      denoise: config.sampling.denoise,
    });
    expect(result.prompt[NODE_IDS.emptyLatent]?.inputs).toEqual({
      width: config.image.width,
      height: config.image.height,
      batch_size: config.image.batchSize,
    });
  });

  test("omits the entire upscale branch when disabled", () => {
    const config = makeConfig({
      upscale: {
        enabled: false,
        method: "bilinear",
        scale: 1.5,
        steps: 30,
        denoise: 0.7,
      },
    });
    const result = buildWorkflow(config, ["a.png", "b.png", "c.png"]);

    expect(result.prompt[NODE_IDS.upscaleLatent]).toBeUndefined();
    expect(result.prompt[NODE_IDS.upscaleSave]).toBeUndefined();
    expect(result.outputKinds).toEqual({ [NODE_IDS.baseSave]: "base" });
    expect(result.outputNodeIds).toEqual({ base: NODE_IDS.baseSave });
  });

  test("adds a second latent sampling and output branch when enabled", () => {
    const config = makeConfig({
      upscale: {
        enabled: true,
        method: "bicubic",
        scale: 2,
        steps: 18,
        denoise: 0.45,
      },
    });
    const result = buildWorkflow(config, ["a.png", "b.png", "c.png"]);

    expect(result.prompt[NODE_IDS.upscaleLatent]?.inputs).toEqual({
      upscale_method: "bicubic",
      scale_by: 2,
      samples: [NODE_IDS.baseSampler, 1],
    });
    expect(result.prompt[NODE_IDS.upscaleScheduler]?.inputs).toMatchObject({
      steps: 18,
      denoise: 0.45,
    });
    expect(result.prompt[NODE_IDS.upscaleSave]).toBeDefined();
    expect(result.outputKinds[NODE_IDS.upscaleSave]).toBe("upscale");
    expect(result.outputNodeIds.upscale).toBe(NODE_IDS.upscaleSave);
  });

  test("resolves random seed once and reuses it for both samplers", () => {
    const config = makeConfig({
      seed: { mode: "random", value: 42 },
      upscale: {
        enabled: true,
        method: "bilinear",
        scale: 1.5,
        steps: 30,
        denoise: 0.7,
      },
    });
    const result = buildWorkflow(config, ["a.png", "b.png", "c.png"], {
      randomSeed: () => 987654,
    });

    expect(result.actualSeed).toBe(987654);
    expect(result.prompt[NODE_IDS.baseNoise]?.inputs.noise_seed).toBe(987654);
    expect(result.prompt[NODE_IDS.upscaleNoise]?.inputs.noise_seed).toBe(
      987654,
    );
  });

  test("upscales a saved base image without rerunning the base sampler", () => {
    const config = makeConfig({
      upscale: {
        enabled: true,
        method: "bicubic",
        scale: 1.5,
        steps: 20,
        denoise: 0.5,
      },
    });
    const result = buildUpscaleWorkflow(
      config,
      ["a.png", "b.png", "c.png"],
      "anima-studio/upscale-sources/base.png",
    );

    expect(result.prompt[NODE_IDS.baseSampler]).toBeUndefined();
    expect(result.prompt[NODE_IDS.baseSave]).toBeUndefined();
    expect(result.outputNodeIds.base).toBeUndefined();
    expect(result.outputKinds).toEqual({
      [NODE_IDS.upscaleSave]: "upscale",
    });
    expect(result.prompt[NODE_IDS.upscaleSourceLoad]).toEqual({
      class_type: "LoadImage",
      inputs: {
        image: "anima-studio/upscale-sources/base.png",
      },
    });
    expect(result.prompt[NODE_IDS.upscaleSourceEncode]?.inputs).toEqual({
      pixels: [NODE_IDS.upscaleSourceLoad, 0],
      vae: [NODE_IDS.vaeLoader, 0],
    });
    expect(result.prompt[NODE_IDS.upscaleLatent]?.inputs.samples).toEqual([
      NODE_IDS.upscaleSourceEncode,
      0,
    ]);
    expect(result.prompt[NODE_IDS.upscaleNoise]?.inputs.noise_seed).toBe(
      123456,
    );
  });

  test("rejects mismatched references, traversal, and invalid CFG ranges", () => {
    expect(() =>
      buildWorkflow(makeConfig(), ["a.png", "b.png"]),
    ).toThrow("must match");

    expect(() =>
      buildWorkflow(makeConfig(), ["../a.png", "b.png", "c.png"]),
    ).toThrow("ComfyUI-relative");

    const invalidCfg = makeConfig({
      sampling: {
        ...makeConfig().sampling,
        cfgStart: 0.8,
        cfgEnd: 0.2,
      },
    });
    expect(() =>
      buildWorkflow(invalidCfg, ["a.png", "b.png", "c.png"]),
    ).toThrow("cfgStart");
  });
});
