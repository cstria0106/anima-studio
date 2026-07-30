import type {
  EngineManifest,
  RuntimeEvent,
  RuntimeMode,
  RuntimeOperationKind,
  RuntimeState,
} from "@anima/runtime";

import {
  ManagedRuntimeInstaller,
  type RuntimeInstallResult,
} from "./installer";
import {
  RuntimeLogService,
  type RuntimeLogEvent,
  type RuntimeLogSubscription,
} from "./logs";
import type { RuntimeStateRepository } from "./repository";
import { ManagedRuntimeSupervisor } from "./supervisor";

export interface RuntimeControllerStatus {
  state: RuntimeState;
  managed: {
    bundleId: string;
    displayName: string;
    installed: boolean;
    controllable: boolean;
  };
}

export interface RuntimeControllerConfiguration {
  mode: RuntimeMode;
  endpoint?: string;
  port?: number;
}

export interface StartedRuntimeOperation {
  operationId: string;
  operation: Extract<
    RuntimeOperationKind,
    "install" | "update" | "repair"
  >;
}

export interface RuntimeOperationSnapshot extends StartedRuntimeOperation {
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
}

interface ActiveOperation {
  snapshot: RuntimeOperationSnapshot;
  abort: AbortController;
  completion: Promise<RuntimeInstallResult>;
}

function normalizedEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("External ComfyUI endpoint must be a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("External ComfyUI endpoint must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "External ComfyUI endpoint must not contain credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export interface ManagedComfyRuntimeControllerOptions {
  repository: RuntimeStateRepository;
  installer: ManagedRuntimeInstaller;
  supervisor: ManagedRuntimeSupervisor;
  logs: RuntimeLogService;
  manifest?: EngineManifest;
}

/**
 * Application-facing facade. Install/update/repair return immediately with the
 * caller-visible operation ID; progress is delivered through the repository's
 * event adapter (and optional subscribeEvents hook).
 */
export class ManagedComfyRuntimeController {
  readonly manifest: EngineManifest;
  private readonly repository: RuntimeStateRepository;
  private readonly installer: ManagedRuntimeInstaller;
  private readonly supervisor: ManagedRuntimeSupervisor;
  private readonly logs: RuntimeLogService;
  private readonly operations = new Map<string, ActiveOperation>();
  private closed = false;

  constructor(options: ManagedComfyRuntimeControllerOptions) {
    this.repository = options.repository;
    this.installer = options.installer;
    this.supervisor = options.supervisor;
    this.logs = options.logs;
    this.manifest = options.manifest ?? options.installer.manifest;
  }

  async status(): Promise<RuntimeControllerStatus> {
    const state = await this.repository.getState();
    if (!state) throw new Error("Runtime state has not been initialized.");
    return {
      state,
      managed: {
        bundleId: this.manifest.bundleId,
        displayName: this.manifest.displayName,
        installed: state.activeBundleId === this.manifest.bundleId,
        controllable: state.mode === "managed",
      },
    };
  }

  async configure(
    input: RuntimeControllerConfiguration,
  ): Promise<RuntimeControllerStatus> {
    const current = await this.repository.getState();
    if (!current) throw new Error("Runtime state has not been initialized.");
    if (current.process) {
      throw new Error("Stop managed ComfyUI before changing runtime mode.");
    }
    if (input.mode === "external") {
      if (!input.endpoint) {
        throw new Error("External mode requires a ComfyUI endpoint.");
      }
      const endpoint = normalizedEndpoint(input.endpoint);
      const url = new URL(endpoint);
      await this.repository.patchState({
        mode: "external",
        endpoint,
        port:
          url.port.length > 0
            ? Number(url.port)
            : url.protocol === "https:"
              ? 443
              : 80,
        status: "stopped",
        operationId: null,
        process: null,
        error: null,
      });
    } else {
      const port =
        input.port ??
        current.port ??
        this.manifest.launch.portRange.from;
      if (
        !Number.isSafeInteger(port) ||
        port < this.manifest.launch.portRange.from ||
        port > this.manifest.launch.portRange.to
      ) {
        throw new Error(
          `Managed ComfyUI port must be in ${this.manifest.launch.portRange.from}-${this.manifest.launch.portRange.to}.`,
        );
      }
      await this.repository.patchState({
        mode: "managed",
        endpoint: `http://${this.manifest.launch.host}:${port}`,
        port,
        status: current.activeBundleId ? "stopped" : "not_installed",
        operationId: null,
        process: null,
        error: null,
      });
    }
    return this.status();
  }

  private beginInstallOperation(
    operation: StartedRuntimeOperation["operation"],
    suppliedOperationId?: string,
  ): StartedRuntimeOperation {
    if (this.closed) throw new Error("Runtime controller is closed.");
    if (
      [...this.operations.values()].some(
        (entry) => entry.snapshot.status === "running",
      )
    ) {
      throw new Error("A managed runtime operation is already running.");
    }
    const operationId = suppliedOperationId ?? crypto.randomUUID();
    if (this.operations.has(operationId)) {
      throw new Error(`Runtime operation ${operationId} already exists.`);
    }
    const abort = new AbortController();
    const snapshot: RuntimeOperationSnapshot = {
      operationId,
      operation,
      status: "running",
      error: null,
    };
    const completion = this.installer
      .install({
        operation,
        operationId,
        signal: abort.signal,
      })
      .then((result) => {
        snapshot.status = "completed";
        return result;
      })
      .catch((error) => {
        snapshot.status = abort.signal.aborted ? "cancelled" : "failed";
        snapshot.error =
          error instanceof Error ? error.message : "Runtime operation failed.";
        throw error;
      });
    // Mark the rejection handled while retaining the original promise for
    // explicit waitOperation callers.
    void completion.catch(() => {});
    this.operations.set(operationId, { snapshot, abort, completion });
    return { operationId, operation };
  }

  install(operationId?: string): StartedRuntimeOperation {
    return this.beginInstallOperation("install", operationId);
  }

  update(operationId?: string): StartedRuntimeOperation {
    return this.beginInstallOperation("update", operationId);
  }

  repair(operationId?: string): StartedRuntimeOperation {
    return this.beginInstallOperation("repair", operationId);
  }

  operation(operationId: string): RuntimeOperationSnapshot | null {
    const operation = this.operations.get(operationId);
    return operation ? structuredClone(operation.snapshot) : null;
  }

  async waitOperation(operationId: string): Promise<RuntimeInstallResult> {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`Unknown runtime operation ${operationId}.`);
    return operation.completion;
  }

  cancelOperation(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation || operation.snapshot.status !== "running") return false;
    operation.abort.abort(new Error("Runtime operation cancelled."));
    return true;
  }

  start(): Promise<RuntimeState> {
    return this.supervisor.start();
  }

  stop(options: {
    force?: boolean;
    hasActiveJobs?: boolean;
  } = {}): Promise<RuntimeState> {
    return this.supervisor.stop(options);
  }

  restart(options: {
    force?: boolean;
    hasActiveJobs?: boolean;
  } = {}): Promise<RuntimeState> {
    return this.supervisor.restart(options);
  }

  recover(): Promise<RuntimeState> {
    return this.supervisor.recover();
  }

  subscribeOperations(
    listener: (event: RuntimeEvent) => void,
  ): { close(): void } {
    if (!this.repository.subscribeEvents) {
      throw new Error(
        "The runtime repository adapter does not expose event subscriptions.",
      );
    }
    return this.repository.subscribeEvents(listener);
  }

  readLogs(sessionId: string, maxBytes?: number): Promise<string> {
    return this.logs.readTail(sessionId, maxBytes);
  }

  tailLogs(
    listener: (event: RuntimeLogEvent) => void,
    sessionId?: string,
  ): RuntimeLogSubscription {
    return this.logs.subscribe((event) => {
      if (!sessionId || event.sessionId === sessionId) listener(event);
    });
  }

  async close(
    options: { stopRuntime?: boolean } = {},
  ): Promise<void> {
    this.closed = true;
    const running = [...this.operations.values()].filter(
      (entry) => entry.snapshot.status === "running",
    );
    for (const operation of running) {
      operation.abort.abort(new Error("Runtime controller is closing."));
    }
    await Promise.allSettled(running.map((operation) => operation.completion));
    await this.supervisor.close(options);
  }
}
