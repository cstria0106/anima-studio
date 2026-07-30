import { describe, expect, test } from "bun:test";

import { createShutdownHandler } from "./lifecycle";

describe("API lifecycle", () => {
  test("closes active HTTP connections and awaits runtime cleanup once", async () => {
    const calls: string[] = [];
    let finishServer!: () => void;
    let finishRuntime!: () => void;
    const shutdown = createShutdownHandler(
      {
        stop(closeActiveConnections) {
          calls.push(`server:${String(closeActiveConnections)}`);
          return new Promise<void>((resolve) => {
            finishServer = resolve;
          });
        },
      },
      {
        close() {
          calls.push("runtime");
          return new Promise<void>((resolve) => {
            finishRuntime = resolve;
          });
        },
      },
    );

    const first = shutdown();
    const second = shutdown();
    await Promise.resolve();

    expect(first).toBe(second);
    expect(calls).toEqual(["server:true", "runtime"]);
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    finishServer();
    await Promise.resolve();
    expect(completed).toBeFalse();
    finishRuntime();
    await first;
    expect(completed).toBeTrue();
  });

  test("still closes the runtime when stopping the HTTP server fails", async () => {
    let runtimeClosed = false;
    const failure = new Error("server stop failed");
    const shutdown = createShutdownHandler(
      {
        stop() {
          throw failure;
        },
      },
      {
        close() {
          runtimeClosed = true;
        },
      },
    );

    await expect(shutdown()).rejects.toBeInstanceOf(AggregateError);
    expect(runtimeClosed).toBeTrue();
  });
});
