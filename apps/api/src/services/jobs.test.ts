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
      buildInpaint() {
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

describe("inpaint jobs", () => {
  test("persists output lineage, source metadata dimensions, mask growth, and the actual seed", async () => {
    const mask = { ...asset("mask", "a".repeat(64)), width: 512, height: 768 };
    const preservedSource = {
      ...asset("preserved-source", "b".repeat(64)),
      width: 512,
      height: 768,
    };
    const sourceOutput = {
      id: "source-output",
      jobId: "source-job",
      kind: "base",
      nodeId: "24",
      filename: "source.png",
      mimeType: "image/png",
      byteSize: 10,
      width: 512,
      height: 768,
      storagePath: "outputs/source-job/source.png",
      comfyFilename: "source.png",
      comfySubfolder: "",
      comfyType: "output",
      folderId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const createdJobs: NewJob[] = [];
    const inpaintBuilds: Array<{
      width: number;
      height: number;
      source: string;
      mask: string;
      grow: number;
      seed: number;
    }> = [];
    const repository = {
      findAsset(id: string) {
        return id === mask.id ? mask : null;
      },
      findOutput(id: string) {
        return id === sourceOutput.id ? sourceOutput : null;
      },
      findJobRow(id: string) {
        return id === sourceOutput.jobId
          ? { id, status: "completed", actualSeed: 1 }
          : null;
      },
      findAssets() {
        return [];
      },
      createJob(input: NewJob) {
        createdJobs.push(structuredClone(input));
        return { id: input.id };
      },
      updateJob() {
        return null;
      },
      findJob(id: string) {
        const created = createdJobs.find((job) => job.id === id)!;
        return {
          id,
          kind: "inpaint",
          parentJobId: "source-job",
          sourceOutputId: sourceOutput.id,
          status: "queued",
          phase: "queued",
          comfyPromptId: "inpaint-prompt",
          queueNumber: null,
          config: created.config,
          actualSeed: created.actualSeed,
          assets: [],
          outputs: [],
          autoTags: "",
          error: null,
          createdAt: created.createdAt,
          startedAt: null,
          completedAt: null,
        } as JobDto;
      },
    } as unknown as StudioRepository;
    const uploaded = (inputName: string): UploadedImage => ({
      filename: inputName.split("/").at(-1)!,
      subfolder: "anima-studio",
      type: "input",
      inputName,
    });
    const storage = {
      async preserveOutputAsAsset() {
        return preservedSource;
      },
      async uploadAssetToComfy(row: AssetRow) {
        return uploaded(`anima-studio/${row.id}.png`);
      },
      async deleteJobData() {
        return true;
      },
    } as unknown as FileStorage;
    const workflow: WorkflowEngine = {
      build(_config, _inputs, actualSeed) {
        return buildResult(actualSeed);
      },
      buildUpscale() {
        throw new Error("Not used in this test.");
      },
      buildInpaint(config, _inputs, source, maskName, grow, actualSeed) {
        inpaintBuilds.push({
          width: config.image.width,
          height: config.image.height,
          source,
          mask: maskName,
          grow,
          seed: actualSeed,
        });
        return { ...buildResult(actualSeed), outputKinds: { "24": "inpaint" } };
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
    const jobs = new JobService(
      repository,
      storage,
      {
        async queuePrompt() {
          return { prompt_id: "inpaint-prompt" };
        },
      } as unknown as ComfyClientLike,
      workflow,
      capabilities,
      { append() {} } as unknown as JobEventService,
      "test-client",
    );
    const config = generationConfigSchema.parse({
      referenceAssetIds: [],
      model: {
        diffusionModel: "diffusion.safetensors",
        clip: "clip.safetensors",
        vae: "vae.safetensors",
      },
      seed: { mode: "fixed", value: 77 },
      image: { width: 1024, height: 1024, batchSize: 2 },
      upscale: { enabled: true },
    });

    const result = await jobs.inpaint({
      source: { type: "output", outputId: sourceOutput.id },
      maskAssetId: mask.id,
      options: { growMaskBy: 9 },
      config,
    });

    expect(result.status).toBe("queued");
    expect(createdJobs).toHaveLength(1);
    expect(createdJobs[0]).toMatchObject({
      kind: "inpaint",
      parentJobId: "source-job",
      sourceOutputId: sourceOutput.id,
      actualSeed: 77,
      assetIds: [],
      inpaint: {
        inputSourceAssetId: preservedSource.id,
        rootSourceAssetId: preservedSource.id,
        maskAssetId: mask.id,
        growMaskBy: 9,
      },
      config: {
        image: { width: 512, height: 768, batchSize: 2 },
        upscale: { enabled: false },
      },
    });
    expect(inpaintBuilds.at(-1)).toEqual({
      width: 512,
      height: 768,
      source: `anima-studio/${preservedSource.id}.png`,
      mask: "anima-studio/mask.png",
      grow: 9,
      seed: 77,
    });
  });

  test("creates a new revision from the preserved root while keeping the previous inpaint as its parent", async () => {
    const root = { ...asset("root", "c".repeat(64)), width: 512, height: 768 };
    const mask = { ...asset("mask", "d".repeat(64)), width: 512, height: 768 };
    const createdJobs: NewJob[] = [];
    const repository = {
      findAsset(id: string) {
        return id === root.id ? root : id === mask.id ? mask : null;
      },
      findJobRow(id: string) {
        return id === "previous-inpaint"
          ? { id, kind: "inpaint", status: "completed" }
          : null;
      },
      findJobInpaint(id: string) {
        return id === "previous-inpaint"
          ? {
              jobId: id,
              inputSourceAssetId: "previous-input",
              rootSourceAssetId: root.id,
              maskAssetId: "previous-mask",
              growMaskBy: 6,
            }
          : null;
      },
      findAssets() {
        return [];
      },
      createJob(input: NewJob) {
        createdJobs.push(structuredClone(input));
        return { id: input.id };
      },
      updateJob() {
        return null;
      },
      findJob(id: string) {
        const created = createdJobs.find((job) => job.id === id)!;
        return {
          id,
          kind: "inpaint",
          parentJobId: "previous-inpaint",
          sourceOutputId: null,
          status: "queued",
          phase: "queued",
          comfyPromptId: "revision-prompt",
          queueNumber: null,
          config: created.config,
          actualSeed: created.actualSeed,
          assets: [],
          outputs: [],
          autoTags: "",
          error: null,
          createdAt: created.createdAt,
          startedAt: null,
          completedAt: null,
        } as JobDto;
      },
    } as unknown as StudioRepository;
    const storage = {
      async uploadAssetToComfy(row: AssetRow) {
        return {
          filename: `${row.id}.png`,
          subfolder: "anima-studio",
          type: "input",
          inputName: `anima-studio/${row.id}.png`,
        } as UploadedImage;
      },
      async deleteJobData() {
        return true;
      },
    } as unknown as FileStorage;
    const workflow = {
      build(
        _config: GenerationConfig,
        _references: string[],
        actualSeed: number,
      ) {
        return buildResult(actualSeed);
      },
      buildInpaint(
        _config: GenerationConfig,
        _references: string[],
        _source: string,
        _mask: string,
        _grow: number,
        actualSeed: number,
      ) {
        return { ...buildResult(actualSeed), outputKinds: { "24": "inpaint" } };
      },
    } as unknown as WorkflowEngine;
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
    const jobs = new JobService(
      repository,
      storage,
      {
        async queuePrompt() {
          return { prompt_id: "revision-prompt" };
        },
      } as unknown as ComfyClientLike,
      workflow,
      capabilities,
      { append() {} } as unknown as JobEventService,
      "test-client",
    );

    await jobs.inpaint({
      source: { type: "asset", assetId: root.id },
      maskAssetId: mask.id,
      revisionOfJobId: "previous-inpaint",
      options: { growMaskBy: 11 },
      config: generationConfigSchema.parse({
        referenceAssetIds: [],
        model: {
          diffusionModel: "diffusion.safetensors",
          clip: "clip.safetensors",
          vae: "vae.safetensors",
        },
        seed: { mode: "fixed", value: 88 },
      }),
    });

    expect(createdJobs).toHaveLength(1);
    expect(createdJobs[0]).toMatchObject({
      kind: "inpaint",
      parentJobId: "previous-inpaint",
      sourceOutputId: null,
      inpaint: {
        inputSourceAssetId: root.id,
        rootSourceAssetId: root.id,
        maskAssetId: mask.id,
        growMaskBy: 11,
      },
    });
  });

  test("rejects a source-mask size mismatch before creating a job", async () => {
    const source = { ...asset("source", "b".repeat(64)), width: 512, height: 512 };
    const mask = { ...asset("mask", "c".repeat(64)), width: 512, height: 504 };
    const repository = {
      findAsset(id: string) {
        return id === source.id ? source : id === mask.id ? mask : null;
      },
      createJob() {
        throw new Error("A mismatched request must not create a job.");
      },
    } as unknown as StudioRepository;
    const jobs = new JobService(
      repository,
      {} as FileStorage,
      {} as ComfyClientLike,
      {} as WorkflowEngine,
      {} as CapabilityService,
      {} as JobEventService,
      "test-client",
    );

    await expect(
      jobs.inpaint({
        source: { type: "asset", assetId: source.id },
        maskAssetId: mask.id,
        options: { growMaskBy: 6 },
        config: generationConfigSchema.parse({
          referenceAssetIds: [],
          model: {
            diffusionModel: "diffusion.safetensors",
            clip: "clip.safetensors",
            vae: "vae.safetensors",
          },
        }),
      }),
    ).rejects.toThrow("same dimensions");
  });
});
