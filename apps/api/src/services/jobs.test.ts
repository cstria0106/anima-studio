import { describe, expect, test } from "bun:test";
import {
  generationConfigSchema,
  type GenerationConfig,
  type JobDto,
} from "@anima/shared";
import type {
  ComfyClientLike,
  UploadedImage,
} from "../comfy/client";
import type {
  NewJob,
  StudioRepository,
} from "../db/repository";
import type { AssetRow } from "../db/schema";
import type { FileStorage } from "../files/storage";
import type {
  WorkflowBuildResult,
  WorkflowEngine,
} from "../workflow/engine";
import type { CapabilityService } from "./capabilities";
import type { JobEventService } from "./job-events";
import { JobService } from "./jobs";

function asset(id: string, sha256: string): AssetRow {
  return {
    id,
    sha256,
    originalName: `${id}.png`,
    mimeType: "image/png",
    byteSize: 1,
    width: 1,
    height: 1,
    storagePath: `assets/${id}.png`,
    comfyFilename: null,
    createdAt: "2026-07-31T00:00:00.000Z",
  };
}

function buildResult(actualSeed: number): WorkflowBuildResult {
  return {
    prompt: {},
    actualSeed,
    nodePhases: {},
    nodeLabels: {},
    outputKinds: {},
    autoTagsNodeId: "tags",
    autoTagsOutputIndex: 0,
  };
}

describe("job reference ordering", () => {
  test("persists, uploads and builds the same SHA-256 order for either request order", async () => {
    const low = asset("asset-low", "0".repeat(64));
    const high = asset("asset-high", "f".repeat(64));
    const assets = new Map([
      [low.id, low],
      [high.id, high],
    ]);
    const createdJobs: NewJob[] = [];
    const uploads: string[] = [];
    const builds: Array<{
      referenceAssetIds: string[];
      inputNames: string[];
    }> = [];

    const repository = {
      findAssets(ids: string[]) {
        return ids.flatMap((id) => {
          const row = assets.get(id);
          return row ? [row] : [];
        });
      },
      createJob(input: NewJob) {
        createdJobs.push(structuredClone(input));
        return { id: input.id };
      },
      updateJob() {
        return null;
      },
      findJob(id: string) {
        return { id, status: "queued" } as JobDto;
      },
    } as unknown as StudioRepository;
    const storage = {
      async uploadAssetToComfy(row: AssetRow): Promise<UploadedImage> {
        uploads.push(row.sha256);
        return {
          filename: `${row.sha256}.png`,
          subfolder: "anima-studio",
          type: "input",
          inputName: `anima-studio/${row.sha256}.png`,
        };
      },
    } as unknown as FileStorage;
    const comfy = {
      async queuePrompt() {
        return { prompt_id: crypto.randomUUID() };
      },
    } as unknown as ComfyClientLike;
    const workflow: WorkflowEngine = {
      build(
        config: GenerationConfig,
        inputNames: string[],
        actualSeed: number,
      ) {
        builds.push({
          referenceAssetIds: [...config.referenceAssetIds],
          inputNames: [...inputNames],
        });
        return buildResult(actualSeed);
      },
      buildUpscale() {
        throw new Error("Not used in this test.");
      },
      capabilities() {
        throw new Error("Not used in this test.");
      },
    };
    const capabilities = {
      async report() {
        return { compatible: true };
      },
      async options() {
        return {
          diffusionModels: ["diffusion.safetensors"],
          clips: ["clip.safetensors"],
          vaes: ["vae.safetensors"],
          loras: [],
          samplers: ["er_sde"],
          schedulers: ["sgm_uniform"],
          imagePresets: [],
        };
      },
    } as unknown as CapabilityService;
    const events = {
      append() {
        return {};
      },
    } as unknown as JobEventService;
    const jobs = new JobService(
      repository,
      storage,
      comfy,
      workflow,
      capabilities,
      events,
      "test-client",
    );
    const baseConfig = generationConfigSchema.parse({
      referenceAssetIds: [low.id],
      model: {
        diffusionModel: "diffusion.safetensors",
        clip: "clip.safetensors",
        vae: "vae.safetensors",
      },
      seed: { mode: "fixed", value: 42 },
    });

    for (const referenceAssetIds of [
      [high.id, low.id],
      [low.id, high.id],
    ]) {
      const [validated] = await jobs.validateBatch([
        { ...baseConfig, referenceAssetIds },
      ]);
      await jobs.createValidated(validated!);
    }

    const expectedIds = [low.id, high.id];
    const expectedHashes = [low.sha256, high.sha256];
    expect(
      createdJobs.map((job) => ({
        referenceAssetIds: job.config.referenceAssetIds,
        assetIds: job.assetIds,
      })),
    ).toEqual([
      { referenceAssetIds: expectedIds, assetIds: expectedIds },
      { referenceAssetIds: expectedIds, assetIds: expectedIds },
    ]);
    expect(uploads).toEqual([...expectedHashes, ...expectedHashes]);

    const submittedBuilds = builds.filter(
      (build) =>
        !build.inputNames[0]?.startsWith("anima-studio/preflight-"),
    );
    expect(submittedBuilds).toEqual([
      {
        referenceAssetIds: expectedIds,
        inputNames: expectedHashes.map(
          (sha256) => `anima-studio/${sha256}.png`,
        ),
      },
      {
        referenceAssetIds: expectedIds,
        inputNames: expectedHashes.map(
          (sha256) => `anima-studio/${sha256}.png`,
        ),
      },
    ]);
  });
});
