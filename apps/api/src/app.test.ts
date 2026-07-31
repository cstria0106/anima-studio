import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generationConfigSchema,
  type CapabilityReport,
  type GenerationConfig,
  type HuggingFaceAnimaCatalogDto,
  type HuggingFaceAnimaDownloadCreate,
  type ModelDownloadDto,
  type ModelDownloadState,
} from "@anima/shared";
import {
  createRuntime,
  RUNTIME_CONFIG_SETTING,
  type ApiRuntime,
  type HuggingFaceLibraryService,
  type ModelLibraryService,
} from "./app";
import type {
  ComfyClientLike,
  DownloadedOutput,
  QueuePromptResult,
  SocketHandle,
  UploadedImage,
  UploadImageInput,
} from "./comfy/client";
import type {
  ComfyHistory,
  ComfyImageRef,
  ComfyObjectInfo,
  ComfyPreviewFrame,
  ComfyPrompt,
  ComfyQueue,
  ComfySocketEvent,
} from "./comfy/types";
import { loadConfig } from "./config";
import { createDatabase } from "./db/database";
import { StudioRepository } from "./db/repository";
import { RUNTIME_STATE_SETTING } from "./runtime/studio";
import { OnboardingService } from "./services/onboarding";
import type {
  WorkflowBuildResult,
  WorkflowEngine,
} from "./workflow/engine";

const runtimes: ApiRuntime[] = [];
const temporaryDirectories: string[] = [];
const testGenerationConfig: GenerationConfig = generationConfigSchema.parse({
  referenceAssetIds: ["placeholder"],
  model: {
    diffusionModel: "test-diffusion.safetensors",
    clip: "test-clip.safetensors",
    vae: "test-vae.safetensors",
  },
});

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakeComfy implements ComfyClientLike {
  constructor(
    readonly baseUrl = "http://fake-comfy.test",
  ) {}
  queuedPromptId = "prompt-1";
  pending = true;
  uploads: UploadImageInput[] = [];
  history: ComfyHistory = {};
  queuedPrompts: ComfyPrompt[] = [];
  queuedExtraData: Record<string, unknown>[] = [];
  connectedClientIds: string[] = [];
  socketHandlers: {
    onOpen?(): void;
    onClose?(): void;
    onError?(error: unknown): void;
    onEvent(event: ComfySocketEvent): void;
    onPreview?(frame: ComfyPreviewFrame): void;
  } | null = null;

  async health(): Promise<boolean> {
    return true;
  }

  async getObjectInfo(): Promise<ComfyObjectInfo> {
    return {};
  }

  async getOptions() {
    return {
      diffusionModels: [testGenerationConfig.model.diffusionModel],
      clips: [testGenerationConfig.model.clip],
      vaes: [testGenerationConfig.model.vae],
      loras: ["style.safetensors"],
      samplers: [testGenerationConfig.sampling.sampler],
      schedulers: [testGenerationConfig.sampling.scheduler],
      imagePresets: [
        {
          label: testGenerationConfig.image.preset,
          width: testGenerationConfig.image.width,
          height: testGenerationConfig.image.height,
        },
      ],
    };
  }

  async getQueue(): Promise<ComfyQueue> {
    return {
      queue_running: [],
      queue_pending: this.pending
        ? ([[0, this.queuedPromptId]] as ComfyQueue["queue_pending"])
        : [],
    };
  }

  async getHistory(_promptId: string): Promise<ComfyHistory> {
    return this.history;
  }

  async uploadImage(input: UploadImageInput): Promise<UploadedImage> {
    this.uploads.push(input);
    return {
      filename: input.filename,
      subfolder: input.subfolder,
      type: "input",
      inputName: `${input.subfolder}/${input.filename}`,
    };
  }

  async queuePrompt(
    prompt: ComfyPrompt,
    _clientId: string,
    extraData: Record<string, unknown> = {},
  ): Promise<QueuePromptResult> {
    this.queuedPrompts.push(prompt);
    this.queuedExtraData.push(extraData);
    this.queuedPromptId = `prompt-${this.queuedPrompts.length}`;
    return {
      prompt_id: this.queuedPromptId,
      number: this.queuedPrompts.length,
    };
  }

  async downloadOutput(_ref: ComfyImageRef): Promise<DownloadedOutput> {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    return { bytes, contentType: "image/png" };
  }

  async cancelQueued(promptId: string): Promise<void> {
    expect(promptId).toBe(this.queuedPromptId);
    this.pending = false;
  }

  async interrupt(): Promise<void> {
    throw new Error("Not used in this test.");
  }

  connect(
    clientId: string,
    _handlers: {
      onOpen?(): void;
      onClose?(): void;
      onError?(error: unknown): void;
      onEvent(event: ComfySocketEvent): void;
      onPreview?(frame: ComfyPreviewFrame): void;
    },
  ): SocketHandle {
    this.connectedClientIds.push(clientId);
    this.socketHandlers = _handlers;
    return { close() {} };
  }
}

class FakeWorkflow implements WorkflowEngine {
  build(
    config: GenerationConfig,
    uploadedInputNames: string[],
    actualSeed: number,
  ): WorkflowBuildResult {
    expect(uploadedInputNames).toHaveLength(1);
    if (config.sampling.cfgStart > config.sampling.cfgEnd) {
      throw new Error("sampling.cfgStart cannot be greater than sampling.cfgEnd");
    }
    return {
      prompt: {
        "1": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "test", images: ["0", 0] },
        },
      },
      actualSeed,
      nodePhases: { "0": "sampling", "1": "saving" },
      nodeLabels: { "0": "Sample image", "1": "Save image" },
      outputKinds: { "1": "base" },
      autoTagsNodeId: "2",
      autoTagsOutputIndex: 0,
    };
  }

  buildUpscale(
    _config: GenerationConfig,
    uploadedInputNames: string[],
    baseImageInputName: string,
    actualSeed: number,
  ): WorkflowBuildResult {
    expect(uploadedInputNames).toHaveLength(1);
    expect(baseImageInputName).toContain(
      "anima-studio/upscale-sources/",
    );
    return {
      prompt: {
        "3": {
          class_type: "SaveImage",
          inputs: {
            filename_prefix: "upscale",
            images: ["2", 0],
          },
        },
      },
      actualSeed,
      nodePhases: { "2": "upscaling", "3": "saving" },
      nodeLabels: { "2": "Upscale sample", "3": "Save upscale" },
      outputKinds: { "3": "upscale" },
      autoTagsNodeId: "4",
      autoTagsOutputIndex: 0,
    };
  }

  capabilities(
    _objectInfo: ComfyObjectInfo,
    comfyUrl: string,
  ): CapabilityReport {
    return {
      compatible: true,
      comfyUrl,
      requiredNodes: [],
      missing: [],
      optional: [],
    };
  }
}

class FakeHuggingFaceLibrary implements HuggingFaceLibraryService {
  readonly revision = "f".repeat(40);
  installCalls = 0;
  resumeCalls = 0;
  retryCalls = 0;

  providerStatus(managedDownloads: boolean, reason?: string) {
    return {
      provider: "huggingface" as const,
      available: managedDownloads,
      repository: "circlestone-labs/Anima" as const,
      managedDownloads,
      supportedFormats: [".safetensors"] as [".safetensors"],
      destinations: [
        {
          id: "diffusion_models" as const,
          label: "Diffusion model",
          kind: "diffusion_models" as const,
        },
        {
          id: "text_encoders" as const,
          label: "Text Encoder",
          kind: "text_encoders" as const,
        },
        {
          id: "vae" as const,
          label: "VAE",
          kind: "vae" as const,
        },
      ],
      ...(reason ? { reason } : {}),
    };
  }

  catalog(): Promise<HuggingFaceAnimaCatalogDto> {
    return Promise.resolve({
      provider: "huggingface",
      repository: "circlestone-labs/Anima",
      sourceUrl: "https://huggingface.co/circlestone-labs/Anima",
      revision: this.revision,
      lastModified: null,
      license: "circlestone-labs-non-commercial-license",
      licenseUrl:
        "https://huggingface.co/circlestone-labs/Anima/blob/main/LICENSE.md",
      thumbnailUrl: null,
      files: [],
    });
  }

  install(_input: HuggingFaceAnimaDownloadCreate) {
    this.installCalls += 1;
    const id = crypto.randomUUID();
    return Promise.resolve({
      downloads: [
        {
          id,
          operationId: crypto.randomUUID(),
          state: "queued" as const,
          provider: "huggingface" as const,
          providerModelId: "circlestone-labs/Anima",
          providerVersionId: this.revision,
          providerFileId: _input.path,
          modelId: null,
          modelVersionId: null,
          fileId: null,
          modelName: "Anima",
          versionName: "latest",
          filename: "anima-base-v1.0.safetensors",
          destinationRootId: "diffusion_models" as const,
          relativeDir: "",
          expectedSha256: "a".repeat(64),
          actualSha256: null,
          bytesCompleted: 0,
          bytesTotal: 100,
          bytesPerSecond: null,
          triggerWords: [],
          metadata: {},
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
      alreadyInstalled: [],
    });
  }

  get(_id: string): ModelDownloadDto {
    throw new Error("Not used in this test.");
  }

  list(_limit?: number): ModelDownloadDto[] {
    return [];
  }

  pause(_id: string): Promise<ModelDownloadDto> {
    throw new Error("Not used in this test.");
  }

  resume(_id: string): ModelDownloadDto {
    this.resumeCalls += 1;
    throw new Error("HF resume crossed the API availability boundary.");
  }

  cancel(_id: string): Promise<ModelDownloadDto> {
    throw new Error("Not used in this test.");
  }

  retry(_id: string): Promise<ModelDownloadDto> {
    this.retryCalls += 1;
    throw new Error("HF retry crossed the API availability boundary.");
  }

  settled(_id: string): Promise<ModelDownloadDto> {
    throw new Error("Not used in this test.");
  }

  reconcileInterruptedDownloads(): ModelDownloadDto[] {
    return [];
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

async function runtime(): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}>;
async function runtime(
  huggingFaceLibrary: HuggingFaceLibraryService,
): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}>;
async function runtime(
  huggingFaceLibrary: undefined,
  modelLibrary: ModelLibraryService,
): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}>;
async function runtime(
  huggingFaceLibrary?: HuggingFaceLibraryService,
  modelLibrary?: ModelLibraryService,
): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "anima-api-test-"));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    databasePath: ":memory:",
    dataDir,
  });
  const comfy = new FakeComfy();
  const database = createDatabase(config);
  const repository = new StudioRepository(database);
  repository.setSetting(RUNTIME_CONFIG_SETTING, {
    mode: "external",
    externalUrl: comfy.baseUrl,
    autoStart: false,
    stopWithApi: false,
    port: null,
  });
  const value = await createRuntime({
    config,
    database,
    repository,
    comfy,
    workflow: new FakeWorkflow(),
    startTracker: false,
    tagDataMode: "fallback",
    ...(huggingFaceLibrary ? { huggingFaceLibrary } : {}),
    ...(modelLibrary ? { modelLibrary } : {}),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  runtimes.push(value);
  return { runtime: value, comfy };
}

async function freshManagedRuntime(): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}>;
async function freshManagedRuntime(
  huggingFaceLibrary: HuggingFaceLibraryService,
): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}>;
async function freshManagedRuntime(
  huggingFaceLibrary?: HuggingFaceLibraryService,
): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "anima-managed-api-test-"));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    databasePath: ":memory:",
    dataDir,
  });
  const comfy = new FakeComfy("http://127.0.0.1:8188");
  const value = await createRuntime({
    config,
    comfy,
    workflow: new FakeWorkflow(),
    tagDataMode: "fallback",
    ...(huggingFaceLibrary ? { huggingFaceLibrary } : {}),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  runtimes.push(value);
  return { runtime: value, comfy };
}

function recordRunningManagedProcess(
  api: ApiRuntime,
  port = 8188,
): void {
  const host = api.runtimeController.manifest.launch.host;
  const runtimeStateRepository = (
    api.runtimeController as unknown as {
      repository: {
        patchState(patch: Record<string, unknown>): unknown;
      };
    }
  ).repository;
  runtimeStateRepository.patchState({
    mode: "managed",
    status: "ready",
    endpoint: `http://${host}:${port}`,
    port,
    activeBundleId: api.runtimeController.manifest.bundleId,
    operationId: null,
    process: {
      pid: 42_424,
      executable: "C:\\managed\\python.exe",
      entrypoint: "ComfyUI\\main.py",
      releaseRoot: "C:\\managed",
      startedAt: new Date().toISOString(),
      port,
      sessionId: "running-managed-runtime",
    },
    error: null,
  });
}

function recordStoppedManagedRuntime(api: ApiRuntime): void {
  const runtimeStateRepository = (
    api.runtimeController as unknown as {
      repository: {
        patchState(patch: Record<string, unknown>): unknown;
      };
    }
  ).repository;
  runtimeStateRepository.patchState({
    mode: "managed",
    status: "stopped",
    activeBundleId: api.runtimeController.manifest.bundleId,
    operationId: null,
    process: null,
    error: null,
  });
}

function createHuggingFaceDownload(
  api: ApiRuntime,
  id: string,
  state: ModelDownloadState,
): ModelDownloadDto {
  const operation = api.operations.create(
    "model_download",
    state,
    `Persisted ${state} download.`,
    { provider: "huggingface" },
  );
  return api.repository.createModelDownload({
    id,
    operationId: operation.id,
    state,
    provider: "huggingface",
    providerModelId: "circlestone-labs/Anima",
    providerVersionId: "f".repeat(40),
    providerFileId:
      "split_files/diffusion_models/anima-base-v1.0.safetensors",
    modelName: "CircleStone Labs Anima",
    versionName: "f".repeat(12),
    filename: "anima-base-v1.0.safetensors",
    destinationRootId: "diffusion_models",
  });
}

async function uploadReference(api: ApiRuntime): Promise<string> {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const form = new FormData();
  form.set("files", new File([png], "avatar.png", { type: "image/png" }));
  const response = await api.app.request("/api/assets", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    assets: Array<{ id: string; width: number; height: number }>;
  };
  expect(body.assets[0]).toMatchObject({ width: 1, height: 1 });
  return body.assets[0]!.id;
}

describe("Anima Studio API", () => {
  test("keeps a previous managed bundle stopped until it is updated", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "anima-managed-upgrade-test-"));
    temporaryDirectories.push(dataDir);
    const config = loadConfig({
      databasePath: ":memory:",
      dataDir,
    });
    const database = createDatabase(config);
    const repository = new StudioRepository(database);
    repository.setSetting(RUNTIME_STATE_SETTING, {
      mode: "managed",
      status: "stopped",
      endpoint: "http://127.0.0.1:8188",
      port: 8188,
      activeBundleId: "anima-comfy-0.29.0-win-nvidia-r3",
      operationId: null,
      process: null,
      error: null,
      updatedAt: new Date().toISOString(),
    });

    const comfy = new FakeComfy("http://127.0.0.1:8188");
    const api = await createRuntime({
      config,
      database,
      repository,
      comfy,
      workflow: new FakeWorkflow(),
      tagDataMode: "fallback",
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });
    runtimes.push({
      ...api,
      close: async () => {
        await api.close();
        database.close();
      },
    });

    const response = await api.app.request("/api/comfy/runtime");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runtime: {
        state: "stopped",
        installed: false,
        bundleId: "anima-comfy-0.29.0-win-nvidia-r3",
        error: null,
      },
    });
    expect(comfy.connectedClientIds).toHaveLength(0);
  });

  test("serves LoRA thumbnails through the same-origin API", async () => {
    const thumbnail = {
      bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
      contentType: "image/jpeg",
    };
    const modelLibrary = {
      providerStatus: async () => ({
        provider: "civitai" as const,
        available: true,
        tokenConfigured: false,
        supportedHosts: ["civitai.com", "civitai.red"] as const,
        supportedFormats: [".safetensors"] as const,
        managedDownloads: true,
        destinations: [],
      }),
      setToken: async () => ({ tokenConfigured: true }),
      deleteToken: async () => ({ tokenConfigured: false }),
      inspect: async () => {
        throw new Error("Not used in this test.");
      },
      create: async () => {
        throw new Error("Not used in this test.");
      },
      settled: async () => {
        throw new Error("Not used in this test.");
      },
      shutdown: async () => {},
      getLoraMetadata: async (installedLoras: string[]) =>
        installedLoras.map((value) => ({
          name: value,
          value,
          triggerWords: [],
          thumbnailUrl: "https://image.civitai.com/style.jpeg",
        })),
      downloadLoraThumbnail: async () => thumbnail,
    } as ModelLibraryService;
    const { runtime: api } = await runtime(undefined, modelLibrary);

    const optionsResponse = await api.app.request("/api/options");
    const options = (await optionsResponse.json()) as {
      loras: Array<{ value: string; thumbnailUrl?: string }>;
    };
    expect(options.loras[0]?.thumbnailUrl).toBe(
      "/api/lora-thumbnail?lora=style.safetensors",
    );

    const thumbnailResponse = await api.app.request(
      options.loras[0]!.thumbnailUrl!,
    );
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/jpeg");
    expect([
      ...new Uint8Array(await thumbnailResponse.arrayBuffer()),
    ]).toEqual([...thumbnail.bytes]);
  });

  test("saves lifecycle preferences while managed ComfyUI is running", async () => {
    const { runtime: api } = await freshManagedRuntime();
    recordRunningManagedProcess(api);
    const config = {
      mode: "managed",
      externalUrl: null,
      autoStart: false,
      stopWithApi: false,
      port: 8188,
    };

    const changedResponse = await api.app.request(
      "/api/comfy/runtime",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      },
    );
    expect(changedResponse.status).toBe(200);
    expect(await changedResponse.json()).toMatchObject({
      runtime: {
        mode: "managed",
        port: 8188,
        autoStart: false,
        stopWithApi: false,
        pid: 42_424,
      },
    });

    const unchangedResponse = await api.app.request(
      "/api/comfy/runtime",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      },
    );
    expect(unchangedResponse.status).toBe(200);

    const savedResponse = await api.app.request("/api/comfy/runtime");
    expect(await savedResponse.json()).toMatchObject({
      runtime: {
        autoStart: false,
        stopWithApi: false,
      },
    });
  });

  test("rejects running runtime target changes before saving preferences", async () => {
    const { runtime: api } = await freshManagedRuntime();
    recordRunningManagedProcess(api);
    const savedConfig = {
      mode: "managed",
      externalUrl: null,
      autoStart: false,
      stopWithApi: false,
      port: 8188,
    };
    const savedResponse = await api.app.request(
      "/api/comfy/runtime",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(savedConfig),
      },
    );
    expect(savedResponse.status).toBe(200);

    const targetChanges = [
      {
        ...savedConfig,
        autoStart: true,
        stopWithApi: true,
        port: 8189,
      },
      {
        mode: "external",
        externalUrl: "http://127.0.0.1:9000",
        autoStart: true,
        stopWithApi: true,
        port: null,
      },
    ];
    for (const targetChange of targetChanges) {
      const rejectedResponse = await api.app.request(
        "/api/comfy/runtime",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(targetChange),
        },
      );
      expect(rejectedResponse.status).toBe(409);

      const currentResponse = await api.app.request(
        "/api/comfy/runtime",
      );
      expect(await currentResponse.json()).toMatchObject({
        runtime: {
          mode: "managed",
          comfyUrl: "http://127.0.0.1:8188",
          port: 8188,
          autoStart: false,
          stopWithApi: false,
          pid: 42_424,
        },
      });
    }
  });

  test("keeps a fresh managed runtime offline until its owned process is ready", async () => {
    const { runtime: api, comfy } = await freshManagedRuntime();
    expect(api.tracker.running).toBe(false);
    expect(comfy.connectedClientIds).toHaveLength(0);

    const optionsResponse = await api.app.request("/api/options");
    expect(optionsResponse.status).toBe(200);
    expect(await optionsResponse.json()).toMatchObject({
      diffusionModels: [],
      clips: [],
      vaes: [],
      loras: [],
      samplers: [],
      schedulers: [],
    });
    expect(comfy.queuedPrompts).toHaveLength(0);

    const capabilityResponse = await api.app.request(
      "/api/capabilities",
    );
    expect(capabilityResponse.status).toBe(200);
    expect(
      ((await capabilityResponse.json()) as { compatible: boolean })
        .compatible,
    ).toBe(false);

    const onboardingResponse = await api.app.request("/api/onboarding");
    expect(onboardingResponse.status).toBe(200);
    expect(await onboardingResponse.json()).toMatchObject({
      onboarding: {
        complete: false,
        steps: expect.any(Array),
      },
    });

    const externalResponse = await api.app.request(
      "/api/comfy/runtime",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "external",
          externalUrl: comfy.baseUrl,
          autoStart: false,
          stopWithApi: false,
          port: null,
        }),
      },
    );
    expect(externalResponse.status).toBe(200);
    expect(api.tracker.running).toBe(true);
    expect(comfy.connectedClientIds).toHaveLength(1);

    const managedResponse = await api.app.request(
      "/api/comfy/runtime",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "managed",
          externalUrl: null,
          autoStart: true,
          stopWithApi: true,
          port: 8188,
        }),
      },
    );
    expect(managedResponse.status).toBe(200);
    expect(api.tracker.running).toBe(false);
  });

  test("does not report unselected model types as missing defaults", async () => {
    const { runtime: api, comfy } = await runtime();
    comfy.getOptions = async () => ({
      diffusionModels: [],
      clips: [],
      vaes: [],
      loras: [],
      samplers: ["er_sde"],
      schedulers: ["sgm_uniform"],
      imagePresets: [],
    });
    api.capabilities.invalidate();

    const response = await api.app.request("/api/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      compatible: true,
      missing: [],
      optional: [],
    });
  });

  test("reports external runtime state without taking process-control ownership", async () => {
    const { runtime: api } = await runtime();

    const statusResponse = await api.app.request("/api/comfy/runtime");
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as {
      runtime: {
        mode: string;
        state: string;
        ready: boolean;
        comfyUrl: string;
        hardware: { platform: string; architecture: string } | null;
      };
    };
    expect(status.runtime).toMatchObject({
      mode: "external",
      state: "ready",
      ready: true,
      comfyUrl: "http://fake-comfy.test",
    });
    expect(status.runtime.hardware).toMatchObject({
      platform: process.platform,
      architecture: process.arch,
    });

    for (const action of ["install", "start", "stop", "restart"]) {
      const response = await api.app.request(
        `/api/comfy/runtime/${action}`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
    }

    const updateResponse = await api.app.request("/api/comfy/runtime", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "external",
        externalUrl: "http://fake-comfy.test",
        autoStart: false,
        stopWithApi: false,
        port: null,
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(
      ((await updateResponse.json()) as {
        runtime: { mode: string; stopWithApi: boolean };
      }).runtime,
    ).toMatchObject({ mode: "external", stopWithApi: false });

    api.repository.createRuntimeSession({
      id: "old-managed-session",
      bundleId: "old-bundle",
      pid: 42,
      executablePath: "C:\\old\\python.exe",
      command: ["python.exe", "main.py"],
      port: 8189,
      logPath: "C:\\old\\runtime.log",
      status: "stopped",
    });
    const logsResponse = await api.app.request(
      "/api/comfy/runtime/logs",
    );
    expect(logsResponse.status).toBe(200);
    expect(await logsResponse.json()).toMatchObject({ entries: [] });
  });

  test("marks managed Civitai downloads unavailable in external mode", async () => {
    const { runtime: api } = await runtime();
    const response = await api.app.request(
      "/api/download-providers/civitai",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      provider: {
        available: boolean;
        managedDownloads: boolean;
        reason?: string;
        destinations: Array<{ id: string }>;
      };
    };
    expect(body.provider.available).toBe(false);
    expect(body.provider.managedDownloads).toBe(false);
    expect(body.provider.reason).toContain("app-managed");
    expect(body.provider.destinations.map((item) => item.id)).toEqual([
      "loras",
      "checkpoints",
      "diffusion_models",
    ]);
  });

  test("lists only managed Civitai LoRA installations", async () => {
    const { runtime: api } = await runtime();
    const installedAt = "2026-07-31T10:00:00.000Z";
    for (const installation of [
      {
        id: "civitai-lora",
        provider: "civitai" as const,
        destinationRootId: "loras" as const,
        modelName: "Civitai style",
      },
      {
        id: "civitai-checkpoint",
        provider: "civitai" as const,
        destinationRootId: "diffusion_models" as const,
        modelName: "Civitai checkpoint",
      },
      {
        id: "huggingface-lora",
        provider: "huggingface" as const,
        destinationRootId: "loras" as const,
        modelName: "Hugging Face LoRA",
      },
    ]) {
      api.repository.upsertManagedModelInstallation({
        ...installation,
        sourceUrl:
          installation.provider === "civitai"
            ? `https://civitai.com/models/${installation.id}?modelVersionId=version-1`
            : null,
        providerModelId: installation.id,
        providerVersionId: "version-1",
        providerFileId: "file-1",
        versionName: "v1",
        filename: `${installation.id}.safetensors`,
        relativeDir: "styles",
        sha256: "a".repeat(64),
        storagePath: join(
          api.config.dataDir,
          `${installation.id}.safetensors`,
        ),
        installedAt,
      });
    }

    const response = await api.app.request(
      "/api/model-installations/civitai/loras",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      installations: [
        expect.objectContaining({
          id: "civitai-lora",
          provider: "civitai",
          sourceUrl:
            "https://civitai.com/models/civitai-lora?modelVersionId=version-1",
          destinationRootId: "loras",
          modelName: "Civitai style",
          relativeDir: "styles",
        }),
      ],
    });
  });

  test("reports Hugging Face installs unavailable and blocks new installs in external mode", async () => {
    const huggingFace = new FakeHuggingFaceLibrary();
    const { runtime: api } = await runtime(huggingFace);

    const providerResponse = await api.app.request(
      "/api/download-providers/huggingface/anima",
    );
    expect(providerResponse.status).toBe(200);
    expect(await providerResponse.json()).toMatchObject({
      provider: {
        available: false,
        managedDownloads: false,
        reason: expect.stringContaining("관리형 ComfyUI"),
      },
      catalog: { revision: huggingFace.revision },
    });

    const installResponse = await api.app.request(
      "/api/model-installations/anima",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: huggingFace.revision,
          path:
            "split_files/diffusion_models/anima-base-v1.0.safetensors",
          includeDependencies: true,
          acceptedLicense: true,
        }),
      },
    );
    expect(installResponse.status).toBe(409);
    expect(huggingFace.installCalls).toBe(0);
  });

  test("does not expose resume or retry actions", async () => {
    const huggingFace = new FakeHuggingFaceLibrary();
    const { runtime: api } = await runtime(huggingFace);
    const paused = createHuggingFaceDownload(
      api,
      "paused-hf-download",
      "paused",
    );
    const failed = createHuggingFaceDownload(
      api,
      "failed-hf-download",
      "failed",
    );

    const resumeResponse = await api.app.request(
      `/api/model-downloads/${paused.id}/resume`,
      { method: "POST" },
    );
    const retryResponse = await api.app.request(
      `/api/model-downloads/${failed.id}/retry`,
      { method: "POST" },
    );

    expect(resumeResponse.status).toBe(404);
    expect(retryResponse.status).toBe(404);
    expect(huggingFace.resumeCalls).toBe(0);
    expect(huggingFace.retryCalls).toBe(0);
  });

  test("allows Hugging Face installs while managed ComfyUI is stopped without consulting Civitai readiness", async () => {
    const huggingFace = new FakeHuggingFaceLibrary();
    const { runtime: api } = await freshManagedRuntime(huggingFace);
    recordStoppedManagedRuntime(api);

    const civitaiResponse = await api.app.request(
      "/api/download-providers/civitai",
    );
    expect(await civitaiResponse.json()).toMatchObject({
      provider: { available: true, managedDownloads: true },
    });
    const huggingFaceResponse = await api.app.request(
      "/api/download-providers/huggingface/anima",
    );
    expect(await huggingFaceResponse.json()).toMatchObject({
      provider: { available: true, managedDownloads: true },
    });

    const installResponse = await api.app.request(
      "/api/model-installations/anima",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: huggingFace.revision,
          path:
            "split_files/diffusion_models/anima-base-v1.0.safetensors",
          includeDependencies: true,
          acceptedLicense: true,
        }),
      },
    );
    expect(installResponse.status).toBe(202);
    expect(huggingFace.installCalls).toBe(1);
  });


  test("rejects non-local browser origins before executing API routes", async () => {
    const { runtime: api } = await runtime();
    const response = await api.app.request("/api/comfy/runtime/stop", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED" },
    });
  });

  test("reuses its ComfyUI client ID across API runtime restarts", async () => {
    const { runtime: first, comfy: firstComfy } = await runtime();
    await first.tracker.start();

    const secondComfy = new FakeComfy();
    const second = await createRuntime({
      config: first.config,
      database: first.database,
      comfy: secondComfy,
      workflow: new FakeWorkflow(),
      startTracker: false,
      tagDataMode: "fallback",
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });
    runtimes.push(second);
    await second.tracker.start();

    expect(firstComfy.connectedClientIds).toHaveLength(1);
    expect(secondComfy.connectedClientIds).toEqual(
      firstComfy.connectedClientIds,
    );
    expect(first.repository.getSetting<string>("comfy-client-id")).toBe(
      firstComfy.connectedClientIds[0]!,
    );

    first.tracker.stop();
    second.tracker.stop();
  });

  test("persists an uploaded asset and queues a validated job", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 1234 },
    };
    const response = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      job: { id: string; status: string; actualSeed: number };
    };
    expect(body.job).toMatchObject({ status: "queued", actualSeed: 1234 });
    expect(comfy.uploads).toHaveLength(1);
    expect(comfy.queuedExtraData[0]?.preview_method).toBe("latent2rgb");

    const detail = await api.app.request(`/api/jobs/${body.job.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      job: {
        id: body.job.id,
        status: "queued",
        assets: [{ id: assetId }],
      },
    });
  });

  test("cancels only the selected pending ComfyUI prompt", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
    };
    const created = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const body = (await created.json()) as { job: { id: string } };
    const cancelled = await api.app.request(
      `/api/jobs/${body.job.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      job: { id: body.job.id, status: "cancelled", phase: "cancelled" },
    });
  });

  test("serves offline tag completions from SQLite FTS", async () => {
    const { runtime: api } = await runtime();
    const response = await api.app.request("/api/tags?q=white%20pup");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tags: [{ tag: "white pupils" }],
    });
  });

  test("adds contextual cooccurrence metadata without changing the tags envelope", async () => {
    const { runtime: api } = await runtime();
    api.repository.replaceTagIndex(
      [
        {
          tag: "1girl",
          category: "general",
          count: 1_000,
          description: "",
        },
        {
          tag: "red eyes",
          category: "general",
          count: 900,
          description: "",
          aliases: ["scarlet eyes"],
        },
        {
          tag: "solo",
          category: "general",
          count: 800,
          description: "",
        },
      ],
      [
        { tag: "1girl", relatedTag: "red eyes", count: 700 },
        { tag: "1girl", relatedTag: "solo", count: 600 },
      ],
      {
        fingerprint: "api-context-fixture",
        source: "danbooru",
        minimumCooccurrenceCount: 0,
      },
    );

    const response = await api.app.request(
      "/api/tags?q=scarlet&context=1girl",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tags: [
        {
          tag: "red eyes",
          aliases: ["scarlet eyes"],
          cooccurrenceCount: 700,
          matchedContext: ["1girl"],
        },
      ],
      related: [
        { tag: "red eyes", cooccurrenceCount: 700 },
        { tag: "solo", cooccurrenceCount: 600 },
      ],
      meta: {
        source: "danbooru",
        query: "scarlet",
        context: ["1girl"],
        cooccurrenceEnabled: true,
      },
    });
  });

  test("recovers a completed ComfyUI job and preserves outputs and tags", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 55 },
    };
    const created = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const body = (await created.json()) as { job: { id: string } };

    comfy.pending = false;
    comfy.history = {
      [comfy.queuedPromptId]: {
        status: { completed: true, status_str: "success", messages: [] },
        outputs: {
          "1": {
            images: [
              { filename: "base_00001_.png", subfolder: "", type: "output" },
            ],
          },
          "2": { text: ["1girl, solo, red eyes"] },
        },
      },
    };
    await api.tracker.start();

    const detail = await api.app.request(`/api/jobs/${body.job.id}`);
    expect(await detail.json()).toMatchObject({
      job: {
        status: "completed",
        phase: "completed",
        autoTags: "1girl, solo, red eyes",
        outputs: [{ kind: "base", width: 1, height: 1 }],
      },
    });
  });

  test("deletes a terminal job together with its stored outputs", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
    };
    const created = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const body = (await created.json()) as { job: { id: string } };

    const activeDelete = await api.app.request(`/api/jobs/${body.job.id}`, {
      method: "DELETE",
    });
    expect(activeDelete.status).toBe(409);

    comfy.pending = false;
    comfy.history = {
      [comfy.queuedPromptId]: {
        status: { completed: true, status_str: "success", messages: [] },
        outputs: {
          "1": {
            images: [{ filename: "base.png", subfolder: "", type: "output" }],
          },
        },
      },
    };
    await api.tracker.start();
    const output = api.repository.listOutputs(body.job.id)[0]!;
    await expect(
      stat(join(api.config.dataDir, output.storagePath)),
    ).resolves.toBeDefined();

    const deleted = await api.app.request(`/api/jobs/${body.job.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(api.repository.findJob(body.job.id)).toBeNull();
    await expect(
      stat(join(api.config.dataDir, output.storagePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(api.repository.findAsset(assetId)).not.toBeNull();
  });

  test("serves the latest denoise preview from memory without writing it to disk", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 99 },
    };
    const created = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const body = (await created.json()) as { job: { id: string } };
    await api.tracker.start();
    comfy.socketHandlers?.onEvent({
      type: "progress",
      data: {
        prompt_id: comfy.queuedPromptId,
        node: "0",
        value: 4,
        max: 30,
      },
    });
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    comfy.socketHandlers?.onPreview?.({
      bytes: png,
      mimeType: "image/png",
      promptId: comfy.queuedPromptId,
      nodeId: "0",
      step: 4,
      total: 30,
    });
    await Bun.sleep(20);

    const preview = await api.app.request(
      `/api/jobs/${body.job.id}/preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(png);
    await expect(
      stat(join(api.config.dataDir, "previews")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const detail = await api.app.request(`/api/jobs/${body.job.id}`);
    expect(await detail.json()).toMatchObject({
      job: {
        preview: {
          mimeType: "image/png",
          revision: 1,
          step: 4,
          total: 30,
        },
      },
    });
    const previewEvent = api.events
      .list(body.job.id)
      .find((event) => event.preview);
    expect(previewEvent?.preview?.url).toContain(
      `/api/jobs/${body.job.id}/preview?v=1`,
    );
  });

  test("queues an upscale-only child job with the original actual seed", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(testGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 55 },
      upscale: {
        ...testGenerationConfig.upscale,
        enabled: false,
      },
    };
    const created = await api.app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const source = (await created.json()) as { job: { id: string } };
    comfy.pending = false;
    comfy.history = {
      [comfy.queuedPromptId]: {
        status: { completed: true, status_str: "success", messages: [] },
        outputs: {
          "1": {
            images: [
              { filename: "base.png", subfolder: "", type: "output" },
            ],
          },
          "2": { text: ["red eyes"] },
        },
      },
    };
    await api.tracker.start();
    const sourceDetail = api.jobs.get(source.job.id);
    expect(sourceDetail.status).toBe("completed");
    const sourceOutput = sourceDetail.outputs[0]!;

    comfy.queuedPromptId = "prompt-upscale";
    comfy.pending = true;
    const response = await api.app.request(
      `/api/jobs/${source.job.id}/upscale`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          upscale: {
            method: "bicubic",
            scale: 2,
            steps: 18,
            denoise: 0.45,
          },
        }),
      },
    );
    expect(response.status).toBe(202);
    const result = (await response.json()) as {
      job: {
        id: string;
        kind: string;
        parentJobId: string;
        sourceOutputId: string;
        actualSeed: number;
        config: GenerationConfig;
      };
    };
    expect(result.job).toMatchObject({
      kind: "upscale",
      parentJobId: source.job.id,
      sourceOutputId: sourceOutput.id,
      actualSeed: 55,
      config: {
        seed: { mode: "fixed", value: 55 },
        upscale: {
          enabled: true,
          method: "bicubic",
          scale: 2,
          steps: 18,
          denoise: 0.45,
        },
      },
    });
    expect(comfy.uploads.at(-1)?.subfolder).toBe(
      "anima-studio/upscale-sources",
    );
    expect(comfy.queuedPrompts.at(-1)?.["3"]?.class_type).toBe(
      "SaveImage",
    );
    const sourceDelete = await api.app.request(
      `/api/jobs/${source.job.id}`,
      { method: "DELETE" },
    );
    expect(sourceDelete.status).toBe(409);
  });

  test("never lets manual onboarding preferences bypass blocking runtime checks", async () => {
    const { runtime: api } = await runtime();
    const onboarding = new OnboardingService(api.repository, async () => ({
      runtimeReady: false,
      runtimeInstalled: false,
      modelsAvailable: false,
      capabilityIssueCount: 2,
    }));
    api.repository.setSetting("onboarding-preferences-v1", {
      dismissed: false,
      completedSteps: ["welcome", "character"],
    });
    const legacyStatus = await onboarding.status();
    expect(legacyStatus.steps.map((step) => step.id)).not.toContain(
      "character",
    );
    expect(
      legacyStatus.steps.find((step) => step.id === "welcome")?.complete,
    ).toBeTrue();

    const status = await onboarding.update({
      completedSteps: [
        "welcome",
        "runtime",
        "models",
        "test_generation",
      ],
    });
    expect(status.complete).toBe(false);
    expect(
      status.steps.filter(
        (step) => step.id === "runtime" || step.id === "models",
      ),
    ).toEqual([
      expect.objectContaining({ id: "runtime", complete: false, blocking: true }),
      expect.objectContaining({ id: "models", complete: false, blocking: true }),
    ]);
  });

  test("removed legacy studio APIs return 404", async () => {
    const { runtime: api } = await runtime();
    const responses = await Promise.all([
      api.app.request("/api/character-profiles"),
      api.app.request("/api/model-packs"),
      api.app.request("/api/portable/export", { method: "POST" }),
      api.app.request("/api/jobs/variations", { method: "POST" }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404,
      404,
      404,
      404,
    ]);
  });

  test("storage cleanup is a dry-run by default and deletes only explicitly selected eligible records", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const dryRun = await api.app.request("/api/storage/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targets: [{ kind: "asset", id: assetId }],
      }),
    });
    expect(dryRun.status).toBe(200);
    expect(await dryRun.json()).toMatchObject({
      cleanup: {
        dryRun: true,
        reclaimedBytes: 0,
        results: [{ id: assetId, eligible: true, deleted: false }],
      },
    });
    expect(api.repository.findAsset(assetId)).not.toBeNull();

    const deleted = await api.app.request("/api/storage/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targets: [{ kind: "asset", id: assetId }],
        dryRun: false,
      }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      cleanup: {
        dryRun: false,
        results: [{ id: assetId, eligible: true, deleted: true }],
      },
    });
    expect(api.repository.findAsset(assetId)).toBeNull();

    const missingTarget = await api.app.request("/api/storage/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: [] }),
    });
    expect(missingTarget.status).toBe(422);
  });

  test("lists and removes LoRAs generated by Instant Reference", async () => {
    const { runtime: api } = await runtime();
    const loraRoot = join(
      api.config.runtimeDir,
      "shared",
      "models",
      "loras",
    );
    const generatedDirectory = join(
      loraRoot,
      "Instant-Reference-Generated",
      "cache-a",
    );
    const generatedLora = join(
      generatedDirectory,
      "instant_lora_a.safetensors",
    );
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(generatedLora, new Uint8Array(128));
    await writeFile(join(generatedDirectory, "training.json"), "{}");
    await writeFile(join(loraRoot, "manual.safetensors"), new Uint8Array(64));

    const inventory = await api.storageInventory.inventory();
    const generatedItems = inventory.items.filter(
      (item) => item.kind === "instant_lora",
    );
    expect(generatedItems).toEqual([
      expect.objectContaining({
        id: "Instant-Reference-Generated/cache-a/instant_lora_a.safetensors",
        name: "Instant-Reference-Generated/cache-a/instant_lora_a.safetensors",
        byteSize: 128,
        cleanupEligible: true,
      }),
    ]);
    expect(
      inventory.categories.find((category) => category.kind === "instant_lora"),
    ).toEqual({ kind: "instant_lora", byteSize: 128, itemCount: 1 });

    const cleanup = await api.storageInventory.cleanup({
      targets: [{ kind: "instant_lora", id: generatedItems[0]!.id }],
      dryRun: false,
    });
    expect(cleanup).toMatchObject({
      reclaimedBytes: 128,
      results: [
        {
          kind: "instant_lora",
          eligible: true,
          deleted: true,
          byteSize: 128,
        },
      ],
    });
    await expect(stat(generatedLora)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(loraRoot, "manual.safetensors"))).size).toBe(64);
  });

  test("storage cleanup rechecks dependencies between review and deletion", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const dryRun = await api.storageInventory.cleanup({
      targets: [{ kind: "asset", id: assetId }],
    });
    expect(dryRun.results[0]).toMatchObject({
      eligible: true,
      deleted: false,
    });

    api.repository.createJob({
      id: crypto.randomUUID(),
      clientId: "cleanup-guard",
      config: {
        ...structuredClone(testGenerationConfig),
        referenceAssetIds: [assetId],
      },
      actualSeed: 42,
      assetIds: [assetId],
      createdAt: new Date().toISOString(),
    });
    const cleanup = await api.storageInventory.cleanup({
      targets: [{ kind: "asset", id: assetId }],
      dryRun: false,
    });
    expect(cleanup.results[0]).toMatchObject({
      eligible: false,
      deleted: false,
      dependencies: [
        expect.objectContaining({ kind: "job" }),
      ],
    });
    expect(api.repository.findAsset(assetId)).not.toBeNull();
  });

  test("storage cleanup reports later missing targets without hiding earlier deletions", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const cleanup = await api.storageInventory.cleanup({
      targets: [
        { kind: "asset", id: assetId },
        { kind: "output", id: "missing-output" },
      ],
      dryRun: false,
    });
    expect(cleanup.results).toEqual([
      expect.objectContaining({
        kind: "asset",
        id: assetId,
        eligible: true,
        deleted: true,
      }),
      expect.objectContaining({
        kind: "output",
        id: "missing-output",
        eligible: false,
        deleted: false,
      }),
    ]);
    expect(api.repository.findAsset(assetId)).toBeNull();
  });

  test("storage inventory reports managed installations but delegates removal to the model library", async () => {
    const { runtime: api } = await runtime();
    const filename = testGenerationConfig.model.diffusionModel;
    const modelDirectory = join(
      api.config.runtimeDir,
      "shared",
      "models",
      "diffusion_models",
    );
    const modelPath = join(modelDirectory, filename);
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(modelPath, new Uint8Array(128));

    const installation = api.repository.upsertManagedModelInstallation({
      id: crypto.randomUUID(),
      provider: "civitai",
      providerModelId: "1",
      providerVersionId: "1",
      providerFileId: "1",
      modelName: "Active model",
      versionName: "v1",
      filename,
      destinationRootId: "diffusion_models",
      sha256: "a".repeat(64),
      storagePath: modelPath,
    });
    const activeJob = api.repository.createJob({
      id: crypto.randomUUID(),
      clientId: "storage-model-test",
      config: structuredClone(testGenerationConfig),
      actualSeed: 42,
      assetIds: [],
      createdAt: new Date().toISOString(),
    });

    const protectedInventory = await api.storageInventory.inventory();
    const protectedModel = protectedInventory.items.find(
      (item) =>
        item.kind === "model_download" && item.id === installation.id,
    );
    expect(protectedModel).toMatchObject({
      byteSize: 128,
      cleanupEligible: false,
      dependencies: [
        expect.objectContaining({ kind: "job", id: activeJob.id }),
      ],
    });

    api.repository.updateJob(activeJob.id, {
      status: "completed",
      phase: "completed",
      completedAt: new Date().toISOString(),
    });
    const cleanup = await api.storageInventory.cleanup({
      targets: [{ kind: "model_download", id: installation.id }],
      dryRun: false,
    });
    expect(cleanup.results[0]).toMatchObject({
      eligible: false,
      deleted: false,
      byteSize: 128,
      reason: "Remove managed models from the model library.",
    });
    const cleanedInventory = await api.storageInventory.inventory();
    expect(
      cleanedInventory.items.find(
        (item) =>
          item.kind === "model_download" &&
          item.id === installation.id,
      ),
    ).toMatchObject({ byteSize: 128, cleanupEligible: false });
  });

});
