import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveRuntimePaths,
  validateEngineManifest,
  type EngineManifest,
} from "@anima/runtime";

import { MODEL_PATHS_FILENAME, RUNTIME_MARKER_FILENAME } from "./installer";
import { RuntimeLogService } from "./logs";
import {
  initialRuntimeState,
  MemoryRuntimeStateRepository,
} from "./repository";
import {
  ManagedRuntimeSupervisor,
  managedRuntimeBaseEnvironment,
  RuntimeBusyError,
  RuntimeOwnershipError,
  type ObservedProcess,
  type RuntimeChildProcess,
  type RuntimeProcessInspector,
  type RuntimeProcessRunner,
  type RuntimeReadinessProbe,
} from "./supervisor";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function manifest(): EngineManifest {
  return validateEngineManifest({
    schemaVersion: 1,
    bundleId: "supervisor-test-r1",
    displayName: "Supervisor Test",
    platform: {
      os: "win32",
      architecture: "x64",
      accelerator: "nvidia",
      minimumFreeBytes: 1,
      recommendedVramMiB: 1,
    },
    launch: {
      executable: "python/python.exe",
      entrypoint: "ComfyUI/main.py",
      arguments: [
        "{entrypoint}",
        "--listen",
        "{host}",
        "--port",
        "{port}",
        "--input-directory",
        "{input}",
        "--output-directory",
        "{output}",
        "--temp-directory",
        "{temp}",
        "--user-directory",
        "{user}",
        "--extra-model-paths-config",
        "{modelPathsConfig}",
      ],
      host: "127.0.0.1",
      portRange: { from: 8188, to: 8188 },
      readinessTimeoutMs: 1_000,
    },
    sharedDirectories: ["input", "output", "temp", "user", "models", "cache"],
    artifacts: [
      {
        id: "engine",
        kind: "engine",
        name: "Test",
        version: "1",
        revision: "a".repeat(40),
        downloadUrl: "https://example.test/test.zip",
        sourceUrl: "https://example.test/source",
        bytes: 1,
        sha256: "b".repeat(64),
        license: "MIT",
        archive: { format: "zip", stripComponents: 0 },
        destination: ".",
      },
    ],
  });
}

class FakeProcessRunner implements RuntimeProcessRunner {
  running = false;
  terminated = false;
  spawnCount = 0;
  arguments: string[] | null = null;
  environment: Record<string, string | undefined> | null = null;
  private resolveExit: ((code: number) => void) | null = null;
  child: RuntimeChildProcess | null = null;

  spawn(input: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }): RuntimeChildProcess {
    this.spawnCount += 1;
    this.arguments = [...input.args];
    this.environment = { ...input.env };
    this.running = true;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    const exited = new Promise<number>((resolve) => {
      this.resolveExit = resolve;
    });
    this.child = {
      pid: 4242,
      stdout: stream(),
      stderr: stream(),
      exited,
      terminate: () => {
        this.terminated = true;
        this.running = false;
        this.resolveExit?.(0);
      },
    };
    return this.child;
  }

  forceExit(code = 1): void {
    this.running = false;
    this.resolveExit?.(code);
  }
}

class FakeInspector implements RuntimeProcessInspector {
  mismatch = false;
  forceTerminated = false;
  observeCount = 0;
  terminateCount = 0;

  constructor(
    private readonly runner: FakeProcessRunner,
    private readonly repository: MemoryRuntimeStateRepository,
  ) {}

  async observe(pid: number): Promise<ObservedProcess | null> {
    this.observeCount += 1;
    if (!this.runner.running) return null;
    const state = await this.repository.getState();
    if (!state.process) return null;
    return {
      pid,
      executable: this.mismatch
        ? "C:\\someone-else\\python.exe"
        : state.process.executable,
      commandLine:
        "python.exe ComfyUI/main.py --listen 127.0.0.1 --port 8188",
      startedAt: state.process.startedAt,
    };
  }

  terminateTree(_pid: number, force: boolean): Promise<void> {
    this.terminateCount += 1;
    this.forceTerminated ||= force;
    this.runner.forceExit(0);
    return Promise.resolve();
  }
}

class FakeReadiness implements RuntimeReadinessProbe {
  interrupted = false;
  fail = false;

  waitUntilReady(): Promise<void> {
    return this.fail
      ? Promise.reject(new Error("readiness failed"))
      : Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(!this.fail);
  }

  interruptAndFree(): Promise<void> {
    this.interrupted = true;
    return Promise.resolve();
  }
}

async function fixture(activeJobs = 0) {
  const root = await mkdtemp(join(tmpdir(), "anima-supervisor-test-"));
  temporaryDirectories.push(root);
  const paths = resolveRuntimePaths(root);
  const runtimeManifest = manifest();
  const releaseRoot = join(paths.releases, runtimeManifest.bundleId);
  await Promise.all([
    mkdir(join(releaseRoot, "python"), { recursive: true }),
    mkdir(join(releaseRoot, "ComfyUI", "custom_nodes"), { recursive: true }),
    mkdir(paths.shared, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(releaseRoot, "python", "python.exe"), ""),
    writeFile(join(releaseRoot, "ComfyUI", "main.py"), ""),
    writeFile(join(releaseRoot, RUNTIME_MARKER_FILENAME), "{}"),
    writeFile(join(paths.shared, MODEL_PATHS_FILENAME), "anima:\n"),
  ]);
  const repository = new MemoryRuntimeStateRepository(
    initialRuntimeState("managed"),
  );
  await repository.patchState({
    status: "stopped",
    activeBundleId: runtimeManifest.bundleId,
    port: 8188,
  });
  const runner = new FakeProcessRunner();
  const inspector = new FakeInspector(runner, repository);
  const readiness = new FakeReadiness();
  const logs = new RuntimeLogService({
    directory: paths.logs,
    maxFileBytes: 10_000,
  });
  const supervisor = new ManagedRuntimeSupervisor({
    paths,
    repository,
    logs,
    manifest: runtimeManifest,
    processRunner: runner,
    processInspector: inspector,
    portProbe: { isAvailable: async () => true },
    readiness,
    jobs: { countActiveJobs: async () => activeJobs },
    gracefulStopMs: 1,
  });
  return {
    supervisor,
    repository,
    runner,
    inspector,
    readiness,
    logs,
    paths,
  };
}

describe("managed runtime supervisor", () => {
  test("inherits only the managed Windows environment allowlist", () => {
    const environment = managedRuntimeBaseEnvironment({
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      CUDA_VISIBLE_DEVICES: "0",
      CIVITAI_API_KEY: "must-not-leak",
      AWS_SECRET_ACCESS_KEY: "must-not-leak",
      ANIMA_PRIVATE_VALUE: "must-not-leak",
    });

    expect(environment).toEqual({
      SYSTEMROOT: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
      TEMP: "C:\\Temp",
      CUDA_VISIBLE_DEVICES: "0",
    });
  });

  test("starts on loopback and refuses a normal stop while jobs are active", async () => {
    const { supervisor, repository, runner, readiness, paths } =
      await fixture(2);

    const started = await supervisor.start();

    expect(started.status).toBe("ready");
    expect(started.endpoint).toBe("http://127.0.0.1:8188");
    expect(runner.arguments?.slice(-2)).toEqual([
      "--database-url",
      `sqlite:///${join(paths.user, "comfyui.db").replaceAll("\\", "/")}`,
    ]);
    expect(
      JSON.parse(runner.environment?.ANIMA_MANAGED_MODEL_ROOTS ?? ""),
    ).toEqual({
      loras: join(paths.models, "loras"),
      checkpoints: join(paths.models, "checkpoints"),
      diffusion_models: join(paths.models, "diffusion_models"),
      text_encoders: join(paths.models, "text_encoders"),
      vae: join(paths.models, "vae"),
    });
    expect(runner.environment?.UV_CACHE_DIR).toBe(
      join(
        paths.root,
        "ir",
        "de43c7266d33",
        "uv",
      ),
    );
    expect(runner.environment?.INSTANT_REFERENCE_RUNTIME_DIR).toBe(
      join(paths.root, "ir", "de43c7266d33"),
    );
    expect(runner.environment?.INSTANT_REFERENCE_PYTHON).toBe(
      join(
        paths.root,
        "ir",
        "de43c7266d33",
        "python312",
        "python.exe",
      ),
    );
    await expect(supervisor.stop()).rejects.toBeInstanceOf(RuntimeBusyError);
    expect(runner.terminated).toBeFalse();

    const stopped = await supervisor.stop({ force: true });

    expect(readiness.interrupted).toBeTrue();
    expect(runner.terminated).toBeTrue();
    expect(stopped.status).toBe("stopped");
    expect((await repository.getState()).process).toBeNull();
  });

  test("never terminates a PID whose executable or start identity changed", async () => {
    const { supervisor, inspector, runner } = await fixture();
    await supervisor.start();
    inspector.mismatch = true;

    await expect(supervisor.stop()).rejects.toBeInstanceOf(
      RuntimeOwnershipError,
    );

    expect(runner.terminated).toBeFalse();
  });

  test("cleans a spawned process when readiness validation fails", async () => {
    const fixtureValue = await fixture();
    fixtureValue.readiness.fail = true;

    await expect(fixtureValue.supervisor.start()).rejects.toThrow(
      "readiness failed",
    );

    expect(fixtureValue.runner.terminated).toBeTrue();
    expect((await fixtureValue.repository.getState()).process).toBeNull();
    expect((await fixtureValue.repository.getState()).status).toBe("failed");
  });

  test("can close API resources without stopping its managed process", async () => {
    const { supervisor, repository, runner } = await fixture();
    await supervisor.start();

    await supervisor.close({ stopRuntime: false });

    expect(runner.terminated).toBeFalse();
    expect((await repository.getState()).status).toBe("ready");
    expect((await repository.getState()).process?.pid).toBe(4242);
  });

  test("marks an owned but unready recovered process failed and never spawns a duplicate", async () => {
    const { supervisor, repository, runner, readiness } =
      await fixture();
    await supervisor.start();
    readiness.fail = true;
    await repository.patchState({ status: "starting" });

    const recovered = await supervisor.recover();

    expect(recovered.status).toBe("failed");
    expect(recovered.process?.pid).toBe(4242);
    expect(recovered.error).toContain("not ready");
    await expect(supervisor.start()).rejects.toBeInstanceOf(
      RuntimeOwnershipError,
    );
    expect(runner.spawnCount).toBe(1);

    await supervisor.stop({ force: true });
  });

  test("does not control a process while configured for external mode", async () => {
    const { supervisor, repository, runner, inspector } = await fixture();
    await repository.patchState({
      mode: "external",
      status: "stopped",
      endpoint: "http://127.0.0.1:8288",
      port: 8288,
      activeBundleId: null,
      process: null,
    });

    await expect(supervisor.start()).rejects.toThrow(
      "cannot start an external",
    );
    await expect(supervisor.stop()).rejects.toThrow(
      "cannot stop an external",
    );
    await supervisor.close();

    expect(runner.spawnCount).toBe(0);
    expect(runner.terminated).toBeFalse();
    expect(inspector.observeCount).toBe(0);
    expect(inspector.terminateCount).toBe(0);
  });

  test("waits for asynchronous exit bookkeeping before stop resolves", async () => {
    const { supervisor, logs } = await fixture();
    await supervisor.start();
    const originalAppend = logs.append.bind(logs);
    let releaseExitLog!: () => void;
    let enteredExitLog!: () => void;
    const exitLogEntered = new Promise<void>((resolve) => {
      enteredExitLog = resolve;
    });
    const exitLogReleased = new Promise<void>((resolve) => {
      releaseExitLog = resolve;
    });
    logs.append = async (sessionId, source, line) => {
      if (line.includes("exited with code")) {
        enteredExitLog();
        await exitLogReleased;
      }
      return originalAppend(sessionId, source, line);
    };

    let stopped = false;
    const stopping = supervisor.stop().then(() => {
      stopped = true;
    });
    await exitLogEntered;
    await Promise.resolve();

    expect(stopped).toBeFalse();
    releaseExitLog();
    await stopping;
    expect(stopped).toBeTrue();
  });
});
