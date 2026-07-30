import { join } from "node:path";
import type {
  RuntimeEvent,
  RuntimeMode,
  RuntimePaths,
  RuntimeState,
} from "@anima/runtime";
import type { StudioRepository } from "../db/repository";
import type { OperationService } from "../services/operations";
import { initialRuntimeState, type RuntimeStateRepository } from "./repository";
import type { RuntimeActiveJobProbe } from "./supervisor";

export const RUNTIME_STATE_SETTING = "managed-runtime-state-v1";

function isRuntimeState(value: unknown): value is RuntimeState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<RuntimeState>;
  return (
    (state.mode === "managed" || state.mode === "external") &&
    typeof state.status === "string" &&
    typeof state.endpoint === "string" &&
    typeof state.updatedAt === "string"
  );
}

function eventProgress(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/**
 * Persists the low-level runtime state in the existing settings table and
 * bridges installer events into the durable OperationService/SSE stream.
 */
export class StudioRuntimeStateRepository
  implements RuntimeStateRepository
{
  private state: RuntimeState;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(
    private readonly repository: StudioRepository,
    private readonly operations: OperationService,
    private readonly paths: RuntimePaths,
    options: {
      initialMode: RuntimeMode;
      initialEndpoint: string;
      bundleId: string;
    },
  ) {
    const saved = repository.getSetting<unknown>(RUNTIME_STATE_SETTING);
    this.state = isRuntimeState(saved)
      ? structuredClone(saved)
      : initialRuntimeState(options.initialMode, options.initialEndpoint);
    if (
      this.state.mode === "managed" &&
      this.state.activeBundleId === null &&
      options.initialMode === "managed"
    ) {
      this.state.endpoint = options.initialEndpoint;
    }
    this.repository.setSetting(RUNTIME_STATE_SETTING, this.state);
  }

  getState(): RuntimeState {
    return structuredClone(this.state);
  }

  patchState(
    patch: Partial<Omit<RuntimeState, "updatedAt">>,
  ): RuntimeState {
    const previous = this.state;
    const next: RuntimeState = {
      ...previous,
      ...structuredClone(patch),
      updatedAt: new Date().toISOString(),
    };
    this.state = next;
    this.repository.setSetting(RUNTIME_STATE_SETTING, next);

    const currentProcess = next.process;
    if (currentProcess) {
      const existing = this.repository.findRuntimeSession(
        currentProcess.sessionId,
      );
      if (!existing) {
        this.repository.createRuntimeSession({
          id: currentProcess.sessionId,
          bundleId: next.activeBundleId ?? "unknown",
          pid: currentProcess.pid,
          executablePath: currentProcess.executable,
          command: [
            currentProcess.executable,
            currentProcess.entrypoint,
            "--listen",
            "127.0.0.1",
            "--port",
            String(currentProcess.port),
          ],
          port: currentProcess.port,
          logPath: join(
            this.paths.logs,
            `${currentProcess.sessionId}.log`,
          ),
          status: next.status,
          startedAt: currentProcess.startedAt,
        });
      } else if (existing.status !== next.status) {
        this.repository.updateRuntimeSession(currentProcess.sessionId, {
          status: next.status,
        });
      }
    }

    if (
      previous.process &&
      previous.process.sessionId !== currentProcess?.sessionId
    ) {
      this.repository.updateRuntimeSession(previous.process.sessionId, {
        status:
          next.status === "failed" ? "failed" : "stopped",
        stoppedAt: new Date().toISOString(),
      });
    }
    return structuredClone(next);
  }

  appendEvent(event: RuntimeEvent): void {
    const operation = this.repository.findSystemOperation(event.operationId);
    if (operation) {
      const progress = eventProgress(event.progress);
      if (event.phase === "complete") {
        this.operations.complete(
          event.operationId,
          "completed",
          event.message,
          {
            ...operation.metadata,
            ...(event.details ?? {}),
          },
        );
      } else if (event.phase === "failed" || event.level === "error") {
        this.operations.fail(
          event.operationId,
          new Error(event.message),
          event.phase,
        );
      } else {
        this.operations.report(event.operationId, {
          phase: event.phase,
          message: event.message,
          status: "running",
          progress,
          bytesCompleted: event.currentBytes,
          bytesTotal: event.totalBytes,
          payload: event.details,
        });
      }
    }
    const stored = structuredClone(event);
    for (const listener of this.listeners) {
      listener(structuredClone(stored));
    }
  }

  subscribeEvents(
    listener: (event: RuntimeEvent) => void,
  ): { close(): void } {
    this.listeners.add(listener);
    return { close: () => this.listeners.delete(listener) };
  }
}

export class StudioRuntimeActiveJobs implements RuntimeActiveJobProbe {
  constructor(private readonly repository: StudioRepository) {}

  countActiveJobs(): Promise<number> {
    return Promise.resolve(
      this.repository.listActiveJobRows().length,
    );
  }
}
