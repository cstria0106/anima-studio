import { describe, expect, test } from "bun:test";
import type { ComfyRuntime } from "@/lib/types";
import {
  runtimeRecoveryAction,
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
});
