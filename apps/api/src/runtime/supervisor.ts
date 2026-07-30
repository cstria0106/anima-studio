import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import {
  MANAGED_ENGINE_MANIFEST,
  type EngineManifest,
  type OwnedRuntimeProcess,
  type RuntimeEvent,
  type RuntimePaths,
  type RuntimeState,
} from "@anima/runtime";

import { MODEL_PATHS_FILENAME, RUNTIME_MARKER_FILENAME } from "./installer";
import { RuntimeLogService } from "./logs";
import {
  managedInstantReferenceRuntimeRoot,
  managedInstantReferenceUvCacheRoot,
  validateManagedCustomNodeAllowlist,
} from "./provision";
import type { RuntimeStateRepository } from "./repository";

export interface RuntimeChildProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  terminate(): void;
}

export interface RuntimeProcessRunner {
  spawn(input: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }): RuntimeChildProcess;
}

const MANAGED_RUNTIME_ENVIRONMENT_KEYS = [
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PATH",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "HOMEDRIVE",
  "HOMEPATH",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "CUDA_PATH",
  "CUDA_VISIBLE_DEVICES",
] as const;

/**
 * Build the minimum parent environment needed by the managed Windows runtime.
 * Environment names are case-insensitive on Windows, so values are normalized
 * to a stable canonical spelling. API keys and unrelated application secrets
 * are intentionally not inherited by ComfyUI.
 */
export function managedRuntimeBaseEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const values = new Map(
    Object.entries(source).map(([key, value]) => [key.toUpperCase(), value]),
  );
  return Object.fromEntries(
    MANAGED_RUNTIME_ENVIRONMENT_KEYS.flatMap((key) => {
      const value = values.get(key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

export class BunRuntimeProcessRunner implements RuntimeProcessRunner {
  spawn(input: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }): RuntimeChildProcess {
    const child = Bun.spawn([input.executable, ...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    // The API shutdown policy decides whether the managed process is stopped.
    // Do not let Bun's child handle override stopWithApi=false by pinning the
    // parent event loop until ComfyUI exits.
    child.unref();
    return {
      pid: child.pid,
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      terminate: () => child.kill(),
    };
  }
}

export interface ObservedProcess {
  pid: number;
  executable: string;
  commandLine: string;
  startedAt: string;
}

export interface RuntimeProcessInspector {
  observe(pid: number): Promise<ObservedProcess | null>;
  terminateTree(pid: number, force: boolean): Promise<void>;
}

async function processOutput(
  command: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

export class WindowsRuntimeProcessInspector
  implements RuntimeProcessInspector
{
  async observe(pid: number): Promise<ObservedProcess | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      "if ($null -eq $p) { exit 3 }",
      "$created = $p.CreationDate.ToUniversalTime().ToString('o')",
      "[pscustomobject]@{ pid = [int]$p.ProcessId; executable = [string]$p.ExecutablePath; commandLine = [string]$p.CommandLine; startedAt = $created } | ConvertTo-Json -Compress",
    ].join("; ");
    const result = await processOutput([
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    if (result.code === 3) return null;
    if (result.code !== 0) {
      throw new Error(
        `Could not inspect managed process ${pid}: ${result.stderr.trim()}`,
      );
    }
    const parsed = JSON.parse(result.stdout) as ObservedProcess;
    return parsed;
  }

  async terminateTree(pid: number, force: boolean): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Refusing to terminate an invalid PID.");
    }
    const result = await processOutput([
      "taskkill.exe",
      "/PID",
      String(pid),
      "/T",
      ...(force ? ["/F"] : []),
    ]);
    if (result.code !== 0 && !/not found|not running/i.test(result.stderr)) {
      throw new Error(
        `Could not terminate managed process ${pid}: ${result.stderr.trim()}`,
      );
    }
  }
}

function normalizedPath(value: string): string {
  return resolve(value).replaceAll("\\", "/").toLowerCase();
}

export function isOwnedRuntimeProcess(
  expected: OwnedRuntimeProcess,
  actual: ObservedProcess,
): boolean {
  if (expected.pid !== actual.pid) return false;
  if (normalizedPath(expected.executable) !== normalizedPath(actual.executable)) {
    return false;
  }
  const expectedStartedAt = Date.parse(expected.startedAt);
  const actualStartedAt = Date.parse(actual.startedAt);
  if (
    !Number.isFinite(expectedStartedAt) ||
    !Number.isFinite(actualStartedAt) ||
    Math.abs(expectedStartedAt - actualStartedAt) > 15_000
  ) {
    return false;
  }
  const commandLine = actual.commandLine.replaceAll("\\", "/").toLowerCase();
  const entrypoint = expected.entrypoint.replaceAll("\\", "/").toLowerCase();
  return (
    commandLine.includes(entrypoint) &&
    new RegExp(`--port(?:=|\\s+)${expected.port}(?:\\s|$)`).test(commandLine) &&
    /--listen(?:=|\s+)127\.0\.0\.1(?:\s|$)/.test(commandLine)
  );
}

export interface RuntimePortProbe {
  isAvailable(host: string, port: number): Promise<boolean>;
}

export class TcpRuntimePortProbe implements RuntimePortProbe {
  isAvailable(host: string, port: number): Promise<boolean> {
    return new Promise((resolveAvailability) => {
      const server = createServer();
      server.unref();
      server.once("error", () => resolveAvailability(false));
      server.listen({ host, port, exclusive: true }, () => {
        server.close(() => resolveAvailability(true));
      });
    });
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export interface RuntimeReadinessProbe {
  waitUntilReady(
    endpoint: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void>;
  isReady(endpoint: string): Promise<boolean>;
  interruptAndFree(endpoint: string): Promise<void>;
}

export class HttpRuntimeReadinessProbe implements RuntimeReadinessProbe {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly validateObjectInfo: (
      objectInfo: Record<string, unknown>,
    ) => void = () => {},
  ) {}

  private async inspect(endpoint: string): Promise<void> {
    const [stats, objectInfo] = await Promise.all([
      this.fetcher(`${endpoint}/system_stats`, {
        signal: AbortSignal.timeout(3_000),
      }),
      this.fetcher(`${endpoint}/object_info`, {
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!stats.ok || !objectInfo.ok) {
      throw new Error(
        `ComfyUI readiness returned HTTP ${stats.status}/${objectInfo.status}.`,
      );
    }
    this.validateObjectInfo(
      (await objectInfo.json()) as Record<string, unknown>,
    );
  }

  async waitUntilReady(
    endpoint: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        await this.inspect(endpoint);
        return;
      } catch (error) {
        lastError = error;
        await delay(500, signal);
      }
    }
    throw new Error("Managed ComfyUI did not become ready before timeout.", {
      cause: lastError,
    });
  }

  async isReady(endpoint: string): Promise<boolean> {
    try {
      await this.inspect(endpoint);
      return true;
    } catch {
      return false;
    }
  }

  async interruptAndFree(endpoint: string): Promise<void> {
    await this.fetcher(`${endpoint}/interrupt`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    await this.fetcher(`${endpoint}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
}

export interface RuntimeActiveJobProbe {
  countActiveJobs(): Promise<number>;
}

export class NoActiveRuntimeJobs implements RuntimeActiveJobProbe {
  countActiveJobs(): Promise<number> {
    return Promise.resolve(0);
  }
}

export class RuntimeOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeOwnershipError";
  }
}

export class RuntimeBusyError extends Error {
  constructor(readonly activeJobs: number) {
    super(`Cannot stop ComfyUI while ${activeJobs} app job(s) are active.`);
    this.name = "RuntimeBusyError";
  }
}

export interface RuntimeSupervisorOptions {
  paths: RuntimePaths;
  repository: RuntimeStateRepository;
  logs: RuntimeLogService;
  manifest?: EngineManifest;
  processRunner?: RuntimeProcessRunner;
  processInspector?: RuntimeProcessInspector;
  portProbe?: RuntimePortProbe;
  readiness?: RuntimeReadinessProbe;
  jobs?: RuntimeActiveJobProbe;
  environmentProvider?: RuntimeEnvironmentProvider;
  now?: () => Date;
  gracefulStopMs?: number;
}

export interface RuntimeEnvironmentContext {
  state: RuntimeState | null;
  releaseRoot: string;
  sessionId: string;
}

export interface RuntimeEnvironmentProvider {
  provide(
    baseEnvironment: Record<string, string | undefined>,
    context: RuntimeEnvironmentContext,
  ):
    | Record<string, string | undefined>
    | Promise<Record<string, string | undefined>>;
}

function runtimeEvent(
  operationId: string,
  operation: "start" | "stop" | "restart",
  phase: string,
  message: string,
  now: () => Date,
  level: RuntimeEvent["level"] = "info",
): RuntimeEvent {
  return {
    operationId,
    operation,
    phase,
    level,
    message,
    progress: null,
    currentBytes: null,
    totalBytes: null,
    createdAt: now().toISOString(),
  };
}

function expandArguments(
  manifest: EngineManifest,
  paths: RuntimePaths,
  releaseRoot: string,
  port: number,
): string[] {
  const values: Record<string, string> = {
    entrypoint: manifest.launch.entrypoint,
    host: manifest.launch.host,
    port: String(port),
    input: paths.input,
    output: paths.output,
    temp: paths.temp,
    user: paths.user,
    modelPathsConfig: join(paths.shared, MODEL_PATHS_FILENAME),
  };
  const manifestArguments = manifest.launch.arguments.map((argument) =>
    argument.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) => {
      const value = values[name];
      if (value === undefined) {
        throw new Error(`Unknown managed launch placeholder ${placeholder}.`);
      }
      return value;
    }),
  );
  const databasePath = resolve(join(paths.user, "comfyui.db")).replaceAll(
    "\\",
    "/",
  );
  return [
    ...manifestArguments,
    "--database-url",
    `sqlite:///${databasePath}`,
  ];
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolveTimeout) =>
      setTimeout(() => resolveTimeout(null), milliseconds),
    ),
  ]);
}

export class ManagedRuntimeSupervisor {
  readonly manifest: EngineManifest;
  private readonly paths: RuntimePaths;
  private readonly repository: RuntimeStateRepository;
  private readonly logs: RuntimeLogService;
  private readonly processRunner: RuntimeProcessRunner;
  private readonly inspector: RuntimeProcessInspector;
  private readonly ports: RuntimePortProbe;
  private readonly readiness: RuntimeReadinessProbe;
  private readonly jobs: RuntimeActiveJobProbe;
  private readonly environmentProvider: RuntimeEnvironmentProvider | null;
  private readonly now: () => Date;
  private readonly gracefulStopMs: number;
  private child: RuntimeChildProcess | null = null;
  private startedSession: string | null = null;
  private exitHandling: Promise<void> | null = null;
  private changing = false;
  private readonly logSecretReleases = new Map<string, () => void>();

  constructor(options: RuntimeSupervisorOptions) {
    this.paths = options.paths;
    this.repository = options.repository;
    this.logs = options.logs;
    this.manifest = options.manifest ?? MANAGED_ENGINE_MANIFEST;
    this.processRunner =
      options.processRunner ?? new BunRuntimeProcessRunner();
    this.inspector =
      options.processInspector ?? new WindowsRuntimeProcessInspector();
    this.ports = options.portProbe ?? new TcpRuntimePortProbe();
    this.readiness =
      options.readiness ?? new HttpRuntimeReadinessProbe();
    this.jobs = options.jobs ?? new NoActiveRuntimeJobs();
    this.environmentProvider = options.environmentProvider ?? null;
    this.now = options.now ?? (() => new Date());
    this.gracefulStopMs = options.gracefulStopMs ?? 10_000;
  }

  private async emit(value: RuntimeEvent): Promise<void> {
    await this.repository.appendEvent(value);
  }

  private async availablePort(preferred: number | null): Promise<number> {
    const candidates = [
      ...(preferred !== null ? [preferred] : []),
      ...Array.from(
        {
          length:
            this.manifest.launch.portRange.to -
            this.manifest.launch.portRange.from +
            1,
        },
        (_, index) => this.manifest.launch.portRange.from + index,
      ),
    ];
    for (const port of new Set(candidates)) {
      if (
        port >= this.manifest.launch.portRange.from &&
        port <= this.manifest.launch.portRange.to &&
        (await this.ports.isAvailable(this.manifest.launch.host, port))
      ) {
        return port;
      }
    }
    throw new Error(
      `No free managed ComfyUI port is available in ${this.manifest.launch.portRange.from}-${this.manifest.launch.portRange.to}.`,
    );
  }

  async start(): Promise<RuntimeState> {
    if (this.changing) throw new Error("Runtime state is already changing.");
    this.changing = true;
    const operationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    let spawned:
      | {
          child: RuntimeChildProcess;
          record: OwnedRuntimeProcess;
        }
      | null = null;
    try {
      const state = await this.repository.getState();
      if (state?.mode === "external") {
        throw new Error("The app cannot start an external ComfyUI process.");
      }
      if (state?.status === "ready" && state.process) return state;
      if (state?.process) {
        throw new RuntimeOwnershipError(
          "A managed ComfyUI process is already recorded. Stop or restart it before starting another process.",
        );
      }
      const bundleId = state?.activeBundleId ?? this.manifest.bundleId;
      const releaseRoot = join(this.paths.releases, bundleId);
      await Promise.all([
        access(join(releaseRoot, RUNTIME_MARKER_FILENAME)),
        access(join(releaseRoot, this.manifest.launch.executable)),
        access(join(releaseRoot, this.manifest.launch.entrypoint)),
        access(join(this.paths.shared, MODEL_PATHS_FILENAME)),
      ]);
      await validateManagedCustomNodeAllowlist(releaseRoot);
      const port = await this.availablePort(state?.port ?? null);
      const endpoint = `http://${this.manifest.launch.host}:${port}`;
      const executable = join(releaseRoot, this.manifest.launch.executable);
      const args = expandArguments(
        this.manifest,
        this.paths,
        releaseRoot,
        port,
      );
      if (args.some((argument) => argument === "--fast")) {
        throw new Error("Managed runtime refuses the quality-changing --fast flag.");
      }
      await this.repository.patchState({
        status: "starting",
        operationId,
        endpoint,
        port,
        error: null,
      });
      await this.emit(
        runtimeEvent(
          operationId,
          "start",
          "spawn",
          `Starting managed ComfyUI on ${endpoint}.`,
          this.now,
        ),
      );
      await this.logs.append(
        sessionId,
        "supervisor",
        `Starting ${this.manifest.displayName} on ${endpoint}.`,
      );
      const instantReferenceRuntime = managedInstantReferenceRuntimeRoot(
        this.paths,
        bundleId,
      );
      const baseEnvironment: Record<string, string | undefined> = {
        ...managedRuntimeBaseEnvironment(),
        INSTANT_REFERENCE_PYTHON: join(
          instantReferenceRuntime,
          "python312",
          "python.exe",
        ),
        INSTANT_REFERENCE_RUNTIME_DIR: instantReferenceRuntime,
        UV_CACHE_DIR: managedInstantReferenceUvCacheRoot(
          this.paths,
          bundleId,
        ),
        COMFYUI_UV: join(
          releaseRoot,
          "_managed",
          "tools",
          "uv",
          "uv.exe",
        ),
        ANIMA_MANAGED_MODEL_ROOTS: JSON.stringify({
          loras: join(this.paths.models, "loras"),
          checkpoints: join(this.paths.models, "checkpoints"),
          diffusion_models: join(
            this.paths.models,
            "diffusion_models",
          ),
          text_encoders: join(this.paths.models, "text_encoders"),
          vae: join(this.paths.models, "vae"),
        }),
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      };
      const environment = this.environmentProvider
        ? await this.environmentProvider.provide(baseEnvironment, {
            state,
            releaseRoot,
            sessionId,
          })
        : baseEnvironment;
      const civitaiSecret = environment.CIVITAI_API_KEY;
      if (civitaiSecret) {
        this.logSecretReleases.set(
          sessionId,
          this.logs.addSecret(civitaiSecret),
        );
      }
      let child: RuntimeChildProcess;
      try {
        child = this.processRunner.spawn({
          executable,
          args,
          cwd: releaseRoot,
          env: environment,
        });
      } finally {
        // Bun.spawn copies the environment synchronously. Do not retain the
        // decrypted credential in the provider-returned object afterwards.
        delete environment.CIVITAI_API_KEY;
      }
      const processRecord: OwnedRuntimeProcess = {
        pid: child.pid,
        executable,
        entrypoint: this.manifest.launch.entrypoint,
        releaseRoot,
        startedAt: this.now().toISOString(),
        port,
        sessionId,
      };
      spawned = { child, record: processRecord };
      this.child = child;
      this.startedSession = sessionId;
      await this.repository.patchState({ process: processRecord });
      void this.logs
        .attach(sessionId, "stdout", child.stdout)
        .catch((error) =>
          this.logs.append(
            sessionId,
            "supervisor",
            `stdout reader failed: ${String(error)}`,
          ),
        );
      void this.logs
        .attach(sessionId, "stderr", child.stderr)
        .catch((error) =>
          this.logs.append(
            sessionId,
            "supervisor",
            `stderr reader failed: ${String(error)}`,
          ),
        );
      const exitHandling = child.exited
        .then((exitCode) => this.handleExit(processRecord, exitCode))
        .catch(async (error) => {
          await this.logs
            .append(
              processRecord.sessionId,
              "supervisor",
              `Managed process exit bookkeeping failed: ${String(error)}`,
            )
            .catch(() => {});
        });
      this.exitHandling = exitHandling;
      void exitHandling.then(() => {
        if (this.exitHandling === exitHandling) this.exitHandling = null;
      });

      await Promise.race([
        this.readiness.waitUntilReady(
          endpoint,
          this.manifest.launch.readinessTimeoutMs,
        ),
        child.exited.then((exitCode) => {
          throw new Error(
            `Managed ComfyUI exited before readiness with code ${exitCode}.`,
          );
        }),
      ]);
      await this.emit(
        runtimeEvent(
          operationId,
          "start",
          "ready",
          "Managed ComfyUI is ready.",
          this.now,
        ),
      );
      return await this.repository.patchState({
        status: "ready",
        operationId: null,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Managed ComfyUI failed to start.";
      if (spawned) {
        try {
          const observed = await this.inspector.observe(spawned.record.pid);
          if (observed && isOwnedRuntimeProcess(spawned.record, observed)) {
            spawned.child.terminate();
            await withTimeout(spawned.child.exited, this.gracefulStopMs);
            await this.exitHandling;
            const remaining = await this.inspector.observe(spawned.record.pid);
            if (remaining && isOwnedRuntimeProcess(spawned.record, remaining)) {
              await this.inspector.terminateTree(spawned.record.pid, true);
            }
          }
        } catch (cleanupError) {
          await this.logs.append(
            spawned.record.sessionId,
            "supervisor",
            `Failed to clean the non-ready process: ${String(cleanupError)}`,
          );
        }
        await this.logs.append(
          spawned.record.sessionId,
          "supervisor",
          `Startup failed: ${message}`,
        );
        await this.logs.flush();
        this.logSecretReleases.get(spawned.record.sessionId)?.();
        this.logSecretReleases.delete(spawned.record.sessionId);
      }
      this.logSecretReleases.get(sessionId)?.();
      this.logSecretReleases.delete(sessionId);
      this.child = null;
      await this.repository.patchState({
        status: "failed",
        operationId: null,
        process: null,
        error: message,
      });
      await this.emit(
        runtimeEvent(
          operationId,
          "start",
          "failed",
          message,
          this.now,
          "error",
        ),
      );
      throw error;
    } finally {
      this.changing = false;
    }
  }

  private async handleExit(
    expected: OwnedRuntimeProcess,
    exitCode: number,
  ): Promise<void> {
    const state = await this.repository.getState();
    if (state?.process?.sessionId !== expected.sessionId) return;
    this.child = null;
    await this.logs.append(
      expected.sessionId,
      "supervisor",
      `Managed ComfyUI exited with code ${exitCode}.`,
    );
    this.logSecretReleases.get(expected.sessionId)?.();
    this.logSecretReleases.delete(expected.sessionId);
    if (state.status === "stopping") {
      await this.repository.patchState({
        status: "stopped",
        operationId: null,
        process: null,
        error: null,
      });
      return;
    }
    await this.repository.patchState({
      status: "failed",
      operationId: null,
      process: null,
      error: `Managed ComfyUI exited unexpectedly with code ${exitCode}.`,
    });
  }

  async stop(options: {
    force?: boolean;
    hasActiveJobs?: boolean;
  } = {}): Promise<RuntimeState> {
    if (this.changing) throw new Error("Runtime state is already changing.");
    this.changing = true;
    const operationId = crypto.randomUUID();
    try {
      const state = await this.repository.getState();
      if (state?.mode === "external") {
        throw new Error("The app cannot stop an external ComfyUI process.");
      }
      if (!state?.process) {
        return await this.repository.patchState({
          status: state?.activeBundleId ? "stopped" : "not_installed",
          operationId: null,
          error: null,
        });
      }
      const activeJobs =
        options.hasActiveJobs === undefined
          ? await this.jobs.countActiveJobs()
          : options.hasActiveJobs
            ? 1
            : 0;
      if (activeJobs > 0 && !options.force) {
        throw new RuntimeBusyError(activeJobs);
      }
      await this.repository.patchState({
        status: "stopping",
        operationId,
        error: null,
      });
      await this.emit(
        runtimeEvent(
          operationId,
          "stop",
          "stopping",
          "Stopping managed ComfyUI.",
          this.now,
        ),
      );
      if (options.force) {
        await this.readiness.interruptAndFree(state.endpoint);
      }

      const observed = await this.inspector.observe(state.process.pid);
      if (!observed) {
        return await this.repository.patchState({
          status: "stopped",
          operationId: null,
          process: null,
          error: null,
        });
      }
      if (!isOwnedRuntimeProcess(state.process, observed)) {
        throw new RuntimeOwnershipError(
          `PID ${state.process.pid} no longer matches the app-owned ComfyUI process; it was not terminated.`,
        );
      }

      if (
        this.child?.pid === state.process.pid &&
        this.startedSession === state.process.sessionId
      ) {
        this.child.terminate();
        await withTimeout(this.child.exited, this.gracefulStopMs);
      } else {
        await this.inspector.terminateTree(state.process.pid, false);
        await delay(this.gracefulStopMs);
      }
      const remaining = await this.inspector.observe(state.process.pid);
      if (remaining) {
        if (!isOwnedRuntimeProcess(state.process, remaining)) {
          throw new RuntimeOwnershipError(
            `PID ${state.process.pid} was reused while stopping; the new process was not terminated.`,
          );
        }
        await this.inspector.terminateTree(state.process.pid, true);
      }
      await this.exitHandling;
      await this.logs.append(
        state.process.sessionId,
        "supervisor",
        "Managed ComfyUI stopped.",
      );
      await this.emit(
        runtimeEvent(
          operationId,
          "stop",
          "stopped",
          "Managed ComfyUI stopped.",
          this.now,
        ),
      );
      return await this.repository.patchState({
        status: "stopped",
        operationId: null,
        process: null,
        error: null,
      });
    } catch (error) {
      if (error instanceof RuntimeBusyError) throw error;
      const message =
        error instanceof Error ? error.message : "Managed ComfyUI failed to stop.";
      await this.repository.patchState({
        status: "failed",
        operationId: null,
        error: message,
      });
      throw error;
    } finally {
      this.changing = false;
    }
  }

  async restart(options: {
    force?: boolean;
    hasActiveJobs?: boolean;
  } = {}): Promise<RuntimeState> {
    await this.stop(options);
    return this.start();
  }

  async recover(): Promise<RuntimeState> {
    const state = await this.repository.getState();
    if (!state) throw new Error("Runtime state has not been initialized.");
    if (state.mode === "external" || !state.process) return state;
    const observed = await this.inspector.observe(state.process.pid);
    if (!observed) {
      return await this.repository.patchState({
        status: "failed",
        process: null,
        operationId: null,
        error: "The previously managed ComfyUI process is no longer running.",
      });
    }
    if (!isOwnedRuntimeProcess(state.process, observed)) {
      return await this.repository.patchState({
        status: "failed",
        operationId: null,
        error:
          "The saved ComfyUI PID belongs to a different process; no process control was attempted.",
      });
    }
    this.startedSession = state.process.sessionId;
    const ready = await this.readiness.isReady(state.endpoint);
    return await this.repository.patchState({
      status: ready ? "ready" : "failed",
      operationId: null,
      error: ready
        ? null
        : "The recovered managed ComfyUI process is running but is not ready. Stop or restart it before continuing.",
    });
  }

  async close(
    options: { stopRuntime?: boolean } = {},
  ): Promise<void> {
    const state = await this.repository.getState();
    if (
      options.stopRuntime !== false &&
      state?.mode === "managed" &&
      state.process &&
      state.process.sessionId === this.startedSession
    ) {
      await this.stop({ force: true }).catch(() => {});
    }
    await this.logs.flush();
  }
}
