import { afterEach, describe, expect, test } from "bun:test";
import { getJob } from "./api";
import type { GenerationDraft } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("history job restoration", () => {
  test("restores the complete generation draft, actual seed, and reference assets through getJob", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl =
        input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify({
          job: {
            id: "job-round-trip",
            parentJobId: null,
            sourceOutputId: null,
            kind: "generation",
            status: "completed",
            phase: "completed",
            comfyPromptId: "prompt-round-trip",
            queueNumber: null,
            config: {
              referenceAssetIds: ["asset-z", "asset-a"],
              prompts: {
                basePositive: "base positive",
                positive: "positive, detailed eyes",
                natural: "soft window light",
                baseNegative: "base negative",
                negative: "low quality, artifact",
              },
              model: {
                diffusionModel: "models/anima-base.safetensors",
                clip: "text_encoders/clip_l.safetensors",
                clipType: "stable_diffusion",
                vae: "vae/anima-vae.safetensors",
                weightDtype: "fp8_e4m3fn",
              },
              loras: [
                {
                  name: "loras/style-one.safetensors",
                  modelStrength: 0.65,
                  clipStrength: 0.45,
                  enabled: true,
                },
                {
                  name: "loras/style-two.safetensors",
                  modelStrength: -0.2,
                  clipStrength: 1.1,
                  enabled: false,
                },
              ],
              instantLora: {
                profile: "anima",
                modelStrength: 0.82,
                clipStrength: 0.73,
                tagging: {
                  generalThreshold: 0.41,
                  characterThreshold: 0.77,
                  prependTags: "prepend one, prepend two",
                  appendTags: "append one",
                  excludeTags: "excluded tag",
                  replaceTags: "old=>new",
                  removeUnderscore: false,
                },
                training: {
                  steps: 321,
                  learningRate: 0.0007,
                  networkDim: 32,
                  networkAlpha: 16,
                  resolution: "1024",
                  gradientCheckpointing: false,
                  cacheLatents: false,
                  cacheTextEncoderOutputs: false,
                  seed: 7654,
                  forceRetrain: true,
                  batchSize: 3,
                },
              },
              seed: {
                mode: "random",
                value: 123,
              },
              sampling: {
                sampler: "dpmpp_2m_sde",
                scheduler: "karras",
                steps: 47,
                denoise: 0.86,
                cfg: 6.25,
                cfgStart: 0.12,
                cfgEnd: 0.91,
              },
              image: {
                width: 1248,
                height: 832,
                batchSize: 4,
                preset: "landscape-test",
              },
              upscale: {
                enabled: true,
                method: "bicubic",
                scale: 2.25,
                steps: 18,
                denoise: 0.31,
              },
            },
            actualSeed: 9_876_543,
            autoTags: "blue eyes, solo",
            error: null,
            createdAt: "2026-07-31T01:02:03.000Z",
            startedAt: "2026-07-31T01:02:04.000Z",
            completedAt: "2026-07-31T01:03:04.000Z",
            assets: [
              {
                id: "asset-z",
                sha256:
                  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                name: "z-reference.png",
                url: "/api/assets/asset-z",
                width: 1280,
                height: 720,
              },
              {
                id: "asset-a",
                sha256:
                  "0000000000000000000000000000000000000000000000000000000000000000",
                name: "a-reference.webp",
                url: "/api/assets/asset-a",
                width: null,
                height: null,
              },
            ],
            outputs: [
              {
                id: "output-base",
                kind: "base",
                url: "/api/outputs/output-base",
                width: 1248,
                height: 832,
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const job = await getJob("job round-trip");
    const {
      referenceAssets,
      sampling,
      ...settingsWithoutRuntimeOverrides
    } = job.settings;

    const expectedSettingsWithoutRuntimeOverrides: Omit<
      GenerationDraft,
      "referenceAssets" | "sampling"
    > = {
      prompts: {
        basePositive: "base positive",
        positive: "positive, detailed eyes",
        natural: "soft window light",
        baseNegative: "base negative",
        negative: "low quality, artifact",
      },
      models: {
        diffusion: "models/anima-base.safetensors",
        clip: "text_encoders/clip_l.safetensors",
        vae: "vae/anima-vae.safetensors",
      },
      loras: [
        {
          id: "history_lora_0_loras/style-one.safetensors",
          name: "loras/style-one.safetensors",
          path: "loras/style-one.safetensors",
          enabled: true,
          modelStrength: 0.65,
          clipStrength: 0.45,
          triggerWords: [],
        },
        {
          id: "history_lora_1_loras/style-two.safetensors",
          name: "loras/style-two.safetensors",
          path: "loras/style-two.safetensors",
          enabled: false,
          modelStrength: -0.2,
          clipStrength: 1.1,
          triggerWords: [],
        },
      ],
      instantLora: {
        modelStrength: 0.82,
        clipStrength: 0.73,
        trainingSteps: 321,
        learningRate: 0.0007,
        dimension: 32,
        alpha: 16,
        cache: false,
        cacheTextEncoderOutputs: false,
        gradientCheckpointing: false,
        forceRetrain: true,
        seed: 7654,
        batchSize: 3,
        resolution: "1024",
      },
      tagging: {
        threshold: 0.41,
        characterThreshold: 0.77,
        prependTags: "prepend one, prepend two",
        appendTags: "append one",
        excludeTags: "excluded tag",
        replaceTags: "old=>new",
        removeUnderscore: false,
      },
      upscale: {
        enabled: true,
        method: "bicubic",
        scale: 2.25,
        steps: 18,
        denoise: 0.31,
      },
    };

    expect(requestedUrl).toBe("/api/jobs/job%20round-trip");
    expect(settingsWithoutRuntimeOverrides).toEqual(
      expectedSettingsWithoutRuntimeOverrides,
    );
    expect(sampling).toEqual({
      seedMode: "fixed",
      seed: 9_876_543,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      steps: 47,
      cfg: 6.25,
      denoise: 0.86,
      width: 1248,
      height: 832,
      batchSize: 4,
      cfgStart: 0.12,
      cfgEnd: 0.91,
    });
    expect(referenceAssets).toEqual([
      {
        id: "asset-z",
        sha256:
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        name: "z-reference.png",
        url: "/api/assets/asset-z",
        width: 1280,
        height: 720,
        status: "ready",
      },
      {
        id: "asset-a",
        sha256:
          "0000000000000000000000000000000000000000000000000000000000000000",
        name: "a-reference.webp",
        url: "/api/assets/asset-a",
        width: undefined,
        height: undefined,
        status: "ready",
      },
    ]);
  });
});
