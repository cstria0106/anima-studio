import type {
  RuntimeEvent,
  RuntimeMode,
  RuntimeState,
} from "@anima/runtime";

export type MaybePromise<T> = T | Promise<T>;

export interface RuntimeStateRepository {
  getState(): MaybePromise<RuntimeState | null>;
  patchState(
    patch: Partial<Omit<RuntimeState, "updatedAt">>,
  ): MaybePromise<RuntimeState>;
  appendEvent(event: RuntimeEvent): MaybePromise<void>;
  subscribeEvents?(
    listener: (event: RuntimeEvent) => void,
  ): { close(): void };
}

export function initialRuntimeState(
  mode: RuntimeMode = "managed",
  endpoint = "http://127.0.0.1:8188",
): RuntimeState {
  return {
    mode,
    status: mode === "managed" ? "not_installed" : "stopped",
    endpoint,
    port: mode === "managed" ? null : Number(new URL(endpoint).port || 80),
    activeBundleId: null,
    operationId: null,
    process: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Useful for tests and for running the supervisor before the Drizzle adapter is
 * wired. Production should provide a transaction-backed implementation.
 */
export class MemoryRuntimeStateRepository implements RuntimeStateRepository {
  private state: RuntimeState;
  readonly events: RuntimeEvent[] = [];
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(initial: RuntimeState = initialRuntimeState()) {
    this.state = structuredClone(initial);
  }

  getState(): RuntimeState {
    return structuredClone(this.state);
  }

  patchState(
    patch: Partial<Omit<RuntimeState, "updatedAt">>,
  ): RuntimeState {
    this.state = {
      ...this.state,
      ...structuredClone(patch),
      updatedAt: new Date().toISOString(),
    };
    return this.getState();
  }

  appendEvent(event: RuntimeEvent): void {
    const stored = structuredClone(event);
    this.events.push(stored);
    for (const listener of this.listeners) listener(structuredClone(stored));
  }

  subscribeEvents(
    listener: (event: RuntimeEvent) => void,
  ): { close(): void } {
    this.listeners.add(listener);
    return { close: () => this.listeners.delete(listener) };
  }
}
