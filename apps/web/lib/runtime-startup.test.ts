import { describe, expect, test } from "bun:test";
import type { ComfyRuntime } from "@/lib/types";
import {
  mergeRuntimeStartupActivity,
  runtimeRecoveryAction,
  runtimeStartupPhaseLabel,
  runtimeStartupDecision,
} from "@/lib/runtime-startup";

const runtime: ComfyRuntime = {
  mode: "managed",
  state: "stopped",
  installed: true,
  ready: false,
  bundleId: "current-bundle",
  comfyVersion: "0.29.0",
  comfyUrl: "http://127.0.0.1:8188",
  externalUrl: null,
  port: 8188,
  pid: null,
  startedAt: null,
  error: null,
  autoStart: true,
  stopWithApi: true,
  hardware: null,
  activeOperationId: null,
};

describe("runtime startup gate", () => {
  test("opens the studio only after ComfyUI is ready", () => {
    expect(
      runtimeStartupDecision({ ...runtime, state: "ready", ready: true }),
    ).toEqual({ kind: "ready" });
  });

  test("updates a previously installed bundle before considering its failure", () => {
    expect(
      runtimeStartupDecision({
        ...runtime,
        state: "failed",
        installed: false,
        bundleId: "previous-bundle",
        error: "Old bundle failed the new allowlist.",
      }).kind,
    ).toBe("update");
  });

  test("waits while the managed runtime is starting", () => {
    expect(
      runtimeStartupDecision({ ...runtime, state: "starting" }).kind,
    ).toBe("wait");
  });

  test("shows the managed runtime failure reason", () => {
    expect(
      runtimeStartupDecision({
        ...runtime,
        state: "failed",
        error: "CUDA driver is unavailable.",
      }),
    ).toEqual({ kind: "failed", message: "CUDA driver is unavailable." });
  });

  test("requires installation for a fresh managed runtime", () => {
    expect(
      runtimeStartupDecision({
        ...runtime,
        state: "not_installed",
        installed: false,
        bundleId: null,
      }).kind,
    ).toBe("failed");
  });

  test("offers the action that resolves each managed terminal state", () => {
    expect(
      runtimeRecoveryAction({
        ...runtime,
        state: "not_installed",
        installed: false,
        bundleId: null,
      }),
    ).toBe("install");
    expect(runtimeRecoveryAction({ ...runtime, state: "failed" })).toBe(
      "repair",
    );
    expect(runtimeRecoveryAction(runtime)).toBe("start");
  });

  test("shows a readable phase while retaining only recent unique activity", () => {
    const operation = {
      id: "operation-1",
      kind: "runtime_update" as const,
      status: "running" as const,
      phase: "provision",
      message: "uv sync --frozen",
      progress: null,
      error: null,
      metadata: {},
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:01Z",
      startedAt: "2026-08-01T00:00:00Z",
      completedAt: null,
    };
    expect(runtimeStartupPhaseLabel(operation)).toBe(
      "Python 실행 환경 구성 중",
    );
    expect(
      mergeRuntimeStartupActivity(
        [{ id: "1", timestamp: "1", message: "첫 번째" }],
        [
          { id: "1", timestamp: "1", message: "중복" },
          { id: "2", timestamp: "2", message: "두 번째" },
          { id: "3", timestamp: "3", message: "세 번째" },
        ],
        2,
      ).map((entry) => entry.message),
    ).toEqual(["두 번째", "세 번째"]);
  });
});
