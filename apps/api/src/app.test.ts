import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultGenerationConfig,
  type CapabilityReport,
  type GenerationConfig,
} from "@anima/shared";
import {
  CIVITAI_RESTART_REQUIRED_SETTING,
  createRuntime,
  type ApiRuntime,
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
import { OnboardingService } from "./services/onboarding";
import {
  ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID,
  LORA_MANAGER_SECRET_PATCH_ID,
} from "./runtime";
import type {
  WorkflowBuildResult,
  WorkflowEngine,
} from "./workflow/engine";

const runtimes: ApiRuntime[] = [];
const temporaryDirectories: string[] = [];

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
      diffusionModels: [defaultGenerationConfig.model.diffusionModel],
      clips: [defaultGenerationConfig.model.clip],
      vaes: [defaultGenerationConfig.model.vae],
      loras: ["style.safetensors"],
      samplers: [defaultGenerationConfig.sampling.sampler],
      schedulers: [defaultGenerationConfig.sampling.scheduler],
      imagePresets: [
        {
          label: defaultGenerationConfig.image.preset,
          width: defaultGenerationConfig.image.width,
          height: defaultGenerationConfig.image.height,
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

async function runtime(): Promise<{
  runtime: ApiRuntime;
  comfy: FakeComfy;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "anima-api-test-"));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    DATABASE_PATH: ":memory:",
    DATA_DIR: dataDir,
    COMFY_URL: "http://fake-comfy.test",
  });
  const comfy = new FakeComfy();
  const value = await createRuntime({
    config,
    comfy,
    workflow: new FakeWorkflow(),
    startTracker: false,
    tagDataMode: "fallback",
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
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "anima-managed-api-test-"));
  temporaryDirectories.push(dataDir);
  const config = loadConfig({
    DATABASE_PATH: ":memory:",
    DATA_DIR: dataDir,
  });
  const comfy = new FakeComfy("http://127.0.0.1:8188");
  const value = await createRuntime({
    config,
    comfy,
    workflow: new FakeWorkflow(),
    tagDataMode: "fallback",
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
      };
    };
    expect(body.provider.available).toBe(false);
    expect(body.provider.managedDownloads).toBe(false);
    expect(body.provider.reason).toContain("app-managed");
  });

  test("blocks managed downloads until an updated Civitai credential is applied", async () => {
    const { runtime: api } = await runtime();
    const releaseRoot = join(api.config.dataDir, "ready-managed-release");
    const managerRoot = join(
      releaseRoot,
      "ComfyUI",
      "custom_nodes",
      "ComfyUI-Lora-Manager",
    );
    const settingsPath = join(
      managerRoot,
      "py",
      "services",
      "settings_manager.py",
    );
    const handlerPath = join(
      managerRoot,
      "py",
      "routes",
      "handlers",
      "model_handlers.py",
    );
    const downloadPath = join(
      managerRoot,
      "py",
      "services",
      "download_manager.py",
    );
    await Promise.all([
      mkdir(join(managerRoot, "py", "routes", "handlers"), {
        recursive: true,
      }),
      mkdir(join(managerRoot, "py", "services"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(managerRoot, `.${LORA_MANAGER_SECRET_PATCH_ID}`),
        LORA_MANAGER_SECRET_PATCH_ID,
      ),
      writeFile(
        join(
          managerRoot,
          `.${ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID}`,
        ),
        ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID,
      ),
      writeFile(settingsPath, LORA_MANAGER_SECRET_PATCH_ID),
      writeFile(handlerPath, ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID),
      writeFile(downloadPath, ANIMA_LORA_MANAGER_DOWNLOAD_PATCH_ID),
    ]);

    const current = await api.runtimeController.status();
    api.runtimeController.status = async () => ({
      ...current,
      state: {
        ...current.state,
        mode: "managed",
        status: "ready",
        activeBundleId: api.runtimeController.manifest.bundleId,
        process: {
          pid: 123,
          executable: "C:\\managed\\python.exe",
          entrypoint: join(releaseRoot, "ComfyUI", "main.py"),
          releaseRoot,
          startedAt: new Date().toISOString(),
          port: 8188,
          sessionId: "managed-test-session",
        },
      },
    });
    api.repository.setSetting(
      CIVITAI_RESTART_REQUIRED_SETTING,
      true,
    );

    const providerResponse = await api.app.request(
      "/api/download-providers/civitai",
    );
    expect(providerResponse.status).toBe(200);
    expect(await providerResponse.json()).toMatchObject({
      provider: {
        available: false,
        managedDownloads: false,
        restartRequired: true,
        reason: expect.stringContaining("Restart managed ComfyUI"),
      },
    });

    const downloadResponse = await api.app.request(
      "/api/model-downloads",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(downloadResponse.status).toBe(409);
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
      ...structuredClone(defaultGenerationConfig),
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
      ...structuredClone(defaultGenerationConfig),
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
      ...structuredClone(defaultGenerationConfig),
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

  test("streams and serves only the latest denoise preview frame", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const config: GenerationConfig = {
      ...structuredClone(defaultGenerationConfig),
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
      ...structuredClone(defaultGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 55 },
      upscale: {
        ...defaultGenerationConfig.upscale,
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
  });

  test("persists reusable character profiles, representatives, model packs, and onboarding progress", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const createdProfile = await api.app.request(
      "/api/character-profiles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Pink cat",
          description: "Primary avatar",
          referenceAssetIds: [assetId],
          excludedTags: ["blue eyes"],
        }),
      },
    );
    expect(createdProfile.status).toBe(201);
    const profile = (await createdProfile.json()) as {
      profile: { id: string; referenceAssets: Array<{ id: string }> };
    };
    expect(profile.profile.referenceAssets).toEqual([
      expect.objectContaining({ id: assetId }),
    ]);

    const jobId = crypto.randomUUID();
    api.repository.createJob({
      id: jobId,
      clientId: "profile-test",
      config: {
        ...structuredClone(defaultGenerationConfig),
        referenceAssetIds: [assetId],
      },
      actualSeed: 42,
      assetIds: [assetId],
      createdAt: new Date().toISOString(),
    });
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    const output = await api.storage.storeOutput({
      jobId,
      kind: "base",
      nodeId: "profile-representative",
      comfyFilename: "representative.png",
      comfySubfolder: "",
      comfyType: "output",
      bytes: png,
      contentType: "image/png",
    });
    const representative = await api.app.request(
      `/api/character-profiles/${profile.profile.id}/representative`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputId: output.id }),
      },
    );
    expect(representative.status).toBe(200);
    expect(await representative.json()).toMatchObject({
      profile: {
        representativeOutputId: output.id,
        representativeOutput: { id: output.id },
      },
    });

    const modelPack = await api.app.request("/api/model-packs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Anima defaults",
        model: defaultGenerationConfig.model,
        loras: [
          {
            name: "style.safetensors",
            modelStrength: 0.8,
            clipStrength: 0.7,
            enabled: true,
          },
        ],
      }),
    });
    expect(modelPack.status).toBe(201);
    expect(await modelPack.json()).toMatchObject({
      modelPack: {
        name: "Anima defaults",
        loras: [{ name: "style.safetensors" }],
      },
    });

    const onboarding = await api.app.request("/api/onboarding");
    expect(onboarding.status).toBe(200);
    expect(await onboarding.json()).toMatchObject({
      onboarding: {
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "character", complete: true }),
        ]),
      },
    });
    const updated = await api.app.request("/api/onboarding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dismissed: true,
        completedSteps: ["welcome"],
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      onboarding: { dismissed: true },
    });
  });

  test("never lets manual onboarding preferences bypass blocking runtime checks", async () => {
    const { runtime: api } = await runtime();
    const onboarding = new OnboardingService(api.repository, async () => ({
      runtimeReady: false,
      runtimeInstalled: false,
      modelsAvailable: false,
      capabilityIssueCount: 2,
    }));
    const status = await onboarding.update({
      completedSteps: [
        "welcome",
        "runtime",
        "models",
        "character",
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

  test("exports verified embedded references and imports them with SHA-256 deduplication and compatibility warnings", async () => {
    const { runtime: api } = await runtime();
    const assetId = await uploadReference(api);
    const profileResponse = await api.app.request(
      "/api/character-profiles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Portable avatar",
          referenceAssetIds: [assetId],
        }),
      },
    );
    const profile = (await profileResponse.json()) as {
      profile: { id: string };
    };
    const duplicateReferenceProfileResponse = await api.app.request(
      "/api/character-profiles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Portable avatar alternate",
          referenceAssetIds: [assetId],
        }),
      },
    );
    const duplicateReferenceProfile =
      (await duplicateReferenceProfileResponse.json()) as {
        profile: { id: string };
      };
    const packResponse = await api.app.request("/api/model-packs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Missing model fixture",
        model: {
          ...defaultGenerationConfig.model,
          diffusionModel: "not-installed.safetensors",
        },
        loras: [],
      }),
    });
    const pack = (await packResponse.json()) as {
      modelPack: { id: string };
    };
    const exported = await api.app.request("/api/portable/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterProfileIds: [
          profile.profile.id,
          duplicateReferenceProfile.profile.id,
        ],
        modelPackIds: [pack.modelPack.id],
      }),
    });
    expect(exported.status).toBe(200);
    const exportBody = (await exported.json()) as {
      bundle: {
        format: string;
        assets: Array<{
          sha256: string;
          byteSize: number;
          dataBase64: string;
          width: number | null;
          height: number | null;
        }>;
        characterProfiles: Array<{
          referenceAssetSha256: string[];
        }>;
      };
    };
    expect(exportBody.bundle.format).toBe("anima-studio-portable");
    expect(exportBody.bundle.assets).toHaveLength(1);
    expect(exportBody.bundle.assets[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(exportBody.bundle.assets[0]!.byteSize).toBeGreaterThan(0);
    expect(exportBody.bundle.assets[0]!.dataBase64.length).toBeGreaterThan(0);
    api.workflow.capabilities = (_objectInfo, comfyUrl) => ({
      compatible: false,
      comfyUrl,
      requiredNodes: ["InstantReferenceLora"],
      missing: [
        {
          kind: "node",
          id: "InstantReferenceLora",
          label: "InstantReferenceLora is not installed.",
          package: "ComfyUI Instant Reference",
        },
      ],
      optional: [],
    });
    api.capabilities.invalidate();

    const previewResponse = await api.app.request(
      "/api/portable/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: exportBody.bundle }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = (await previewResponse.json()) as {
      preview: {
        valid: boolean;
        assetCount: number;
        newAssetCount: number;
        deduplicatedAssetCount: number;
        characterProfileCount: number;
        missing: Array<{ kind: string; id: string }>;
      };
    };
    expect(previewBody.preview).toMatchObject({
      valid: true,
      assetCount: 1,
      newAssetCount: 0,
      deduplicatedAssetCount: 1,
      characterProfileCount: 2,
    });
    expect(previewBody.preview.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model",
          id: "not-installed.safetensors",
        }),
        expect.objectContaining({
          kind: "node",
          id: "InstantReferenceLora",
        }),
      ]),
    );

    const importResponse = await api.app.request("/api/portable/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: exportBody.bundle }),
    });
    expect(importResponse.status).toBe(201);
    expect(await importResponse.json()).toMatchObject({
      result: {
        preview: { deduplicatedAssetCount: 1 },
        characterProfiles: [
          { name: "Portable avatar" },
          { name: "Portable avatar alternate" },
        ],
        modelPacks: [{ name: "Missing model fixture" }],
      },
    });
    expect(api.repository.listAssetRows()).toHaveLength(1);

    const tampered = structuredClone(exportBody.bundle);
    tampered.assets[0]!.dataBase64 =
      `${tampered.assets[0]!.dataBase64.slice(0, -4)}AAAA`;
    const rejected = await api.app.request(
      "/api/portable/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: tampered }),
      },
    );
    expect(rejected.status).toBe(422);

    const oversized = structuredClone(exportBody.bundle);
    const oversizedBytes = new Uint8Array(24);
    oversizedBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const oversizedView = new DataView(oversizedBytes.buffer);
    oversizedView.setUint32(16, 20_000);
    oversizedView.setUint32(20, 20_000);
    const oversizedHash = createHash("sha256")
      .update(oversizedBytes)
      .digest("hex");
    const originalHash = oversized.assets[0]!.sha256;
    oversized.assets[0] = {
      ...oversized.assets[0]!,
      sha256: oversizedHash,
      byteSize: oversizedBytes.byteLength,
      width: 20_000,
      height: 20_000,
      dataBase64: Buffer.from(oversizedBytes).toString("base64"),
    };
    for (const profileEntry of oversized.characterProfiles) {
      profileEntry.referenceAssetSha256 =
        profileEntry.referenceAssetSha256.map((sha256) =>
          sha256 === originalHash ? oversizedHash : sha256,
        );
    }
    const oversizedPreview = await api.app.request(
      "/api/portable/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: oversized }),
      },
    );
    expect(oversizedPreview.status).toBe(413);
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

    api.library.createCharacterProfile({
      name: "Cleanup guard",
      referenceAssetIds: [assetId],
    });
    const cleanup = await api.storageInventory.cleanup({
      targets: [{ kind: "asset", id: assetId }],
      dryRun: false,
    });
    expect(cleanup.results[0]).toMatchObject({
      eligible: false,
      deleted: false,
      dependencies: [
        expect.objectContaining({ kind: "character_profile" }),
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
        { kind: "preview", id: "missing-preview" },
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
        kind: "preview",
        id: "missing-preview",
        eligible: false,
        deleted: false,
      }),
    ]);
    expect(api.repository.findAsset(assetId)).toBeNull();
  });

  test("storage inventory protects models used by active jobs and stops counting deleted files", async () => {
    const { runtime: api } = await runtime();
    const filename = defaultGenerationConfig.model.diffusionModel;
    const modelDirectory = join(
      api.config.runtimeDir,
      "shared",
      "models",
      "diffusion_models",
    );
    const modelPath = join(modelDirectory, filename);
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(modelPath, new Uint8Array(128));

    const operationId = crypto.randomUUID();
    api.repository.createSystemOperation({
      id: operationId,
      kind: "model_download",
      status: "completed",
      phase: "completed",
    });
    const download = api.repository.createModelDownload({
      id: crypto.randomUUID(),
      operationId,
      state: "completed",
      modelId: 1,
      modelVersionId: 1,
      modelName: "Active model",
      versionName: "v1",
      filename,
      destinationRootId: "diffusion_models",
      bytesTotal: 128,
    });
    api.repository.updateModelDownload(download.id, {
      state: "completed",
      storagePath: modelPath,
      bytesCompleted: 128,
      completedAt: new Date().toISOString(),
    });
    const activeJob = api.repository.createJob({
      id: crypto.randomUUID(),
      clientId: "storage-model-test",
      config: structuredClone(defaultGenerationConfig),
      actualSeed: 42,
      assetIds: [],
      createdAt: new Date().toISOString(),
    });

    const protectedInventory = await api.storageInventory.inventory();
    const protectedModel = protectedInventory.items.find(
      (item) => item.kind === "model_download" && item.id === download.id,
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
      targets: [{ kind: "model_download", id: download.id }],
      dryRun: false,
    });
    expect(cleanup.results[0]).toMatchObject({
      deleted: true,
      byteSize: 128,
    });
    const cleanedInventory = await api.storageInventory.inventory();
    expect(
      cleanedInventory.items.find(
        (item) => item.kind === "model_download" && item.id === download.id,
      ),
    ).toMatchObject({ byteSize: 0, cleanupEligible: false });
  });

  test("validates an entire variation matrix before queueing up to sixteen jobs", async () => {
    const { runtime: api, comfy } = await runtime();
    const assetId = await uploadReference(api);
    const baseConfig: GenerationConfig = {
      ...structuredClone(defaultGenerationConfig),
      referenceAssetIds: [assetId],
      seed: { mode: "fixed", value: 101 },
    };
    const created = await api.app.request("/api/jobs/variations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseConfig,
        axes: [
          {
            kind: "prompt",
            values: [
              { label: "Smile", positive: "smile" },
              { label: "Wink", positive: "wink" },
            ],
          },
          {
            kind: "seed",
            values: [11, 12],
          },
        ],
      }),
    });
    expect(created.status).toBe(202);
    const createdBody = (await created.json()) as {
      batch: { id: string; jobs: unknown[] };
      jobs: unknown[];
    };
    expect(createdBody.batch.id).toBeString();
    expect(createdBody.batch.jobs).toHaveLength(4);
    expect(createdBody.jobs).toHaveLength(4);
    expect(comfy.queuedPrompts).toHaveLength(4);

    const queuedBeforeInvalidRequest = comfy.queuedPrompts.length;
    const invalid = await api.app.request("/api/jobs/variations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseConfig,
        combinations: [
          { label: "Valid", config: baseConfig },
          {
            label: "Missing model",
            config: {
              ...baseConfig,
              model: {
                ...baseConfig.model,
                diffusionModel: "missing.safetensors",
              },
            },
          },
        ],
      }),
    });
    expect(invalid.status).toBe(422);
    expect(comfy.queuedPrompts).toHaveLength(queuedBeforeInvalidRequest);

    const builderInvalid = await api.app.request("/api/jobs/variations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseConfig,
        combinations: [
          { label: "Valid", config: baseConfig },
          {
            label: "Invalid CFG interval",
            config: {
              ...baseConfig,
              sampling: {
                ...baseConfig.sampling,
                cfgStart: 0.9,
                cfgEnd: 0.1,
              },
            },
          },
        ],
      }),
    });
    expect(builderInvalid.status).toBe(422);
    expect(comfy.queuedPrompts).toHaveLength(queuedBeforeInvalidRequest);

    const tooMany = await api.app.request("/api/jobs/variations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseConfig,
        axes: [
          {
            kind: "seed",
            values: Array.from({ length: 17 }, (_, index) => index),
          },
        ],
      }),
    });
    expect(tooMany.status).toBe(422);
    expect(comfy.queuedPrompts).toHaveLength(queuedBeforeInvalidRequest);
  });
});
