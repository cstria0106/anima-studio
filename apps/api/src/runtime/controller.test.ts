import { describe, expect, test } from "bun:test";

import { MANAGED_ENGINE_MANIFEST } from "@anima/runtime";

import { ManagedComfyRuntimeController } from "./controller";
import type {
  ManagedRuntimeInstaller,
  RuntimeInstallResult,
} from "./installer";
import type { RuntimeLogService } from "./logs";
import {
  initialRuntimeState,
  MemoryRuntimeStateRepository,
} from "./repository";
import type { ManagedRuntimeSupervisor } from "./supervisor";

type InstallOptions = NonNullable<
  Parameters<ManagedRuntimeInstaller["install"]>[0]
>;

function installResult(operationId: string): RuntimeInstallResult {
  return {
    operationId,
    releaseRoot: "C:\\managed\\release",
    marker: {
      schemaVersion: 1,
      bundleId: MANAGED_ENGINE_MANIFEST.bundleId,
      installedAt: new Date(0).toISOString(),
      manifestSha256: "a".repeat(64),
      artifacts: [],
    },
    preflight: {
      compatible: true,
      platform: "win32",
      architecture: "x64",
      freeBytes: 1,
      nvidiaDevices: [{ name: "test", vramMiB: 24_576 }],
      issues: [],
    },
    reused: false,
  };
}

function fixture(
  install: (options: InstallOptions) => Promise<RuntimeInstallResult>,
) {
  const repository = new MemoryRuntimeStateRepository(
    initialRuntimeState("managed"),
  );
  const closeCalls: Array<{ stopRuntime?: boolean }> = [];
  const installer = {
    manifest: MANAGED_ENGINE_MANIFEST,
    install,
  } as unknown as ManagedRuntimeInstaller;
  const supervisor = {
    close: async (options: { stopRuntime?: boolean } = {}) => {
      closeCalls.push(options);
    },
  } as unknown as ManagedRuntimeSupervisor;
  const controller = new ManagedComfyRuntimeController({
    repository,
    installer,
    supervisor,
    logs: {} as RuntimeLogService,
  });
  return { controller, closeCalls };
}

describe("managed runtime controller", () => {
  test("uses the caller-supplied operation ID exactly once", async () => {
    let received: InstallOptions | undefined;
    const { controller } = fixture(async (options) => {
      received = options;
      return installResult(options.operationId!);
    });

    expect(controller.install("database-first-operation")).toEqual({
      operationId: "database-first-operation",
      operation: "install",
    });
    await controller.waitOperation("database-first-operation");

    expect(received?.operationId).toBe("database-first-operation");
    expect(() => controller.install("database-first-operation")).toThrow(
      "already exists",
    );
  });

  test("cancels installation but preserves ComfyUI when API shutdown opts out", async () => {
    let installSignal: AbortSignal | undefined;
    const { controller, closeCalls } = fixture(
      (options) =>
        new Promise<RuntimeInstallResult>((_resolve, reject) => {
          installSignal = options.signal;
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    controller.install("in-flight-install");

    await controller.close({ stopRuntime: false });

    expect(installSignal?.aborted).toBeTrue();
    expect(controller.operation("in-flight-install")?.status).toBe(
      "cancelled",
    );
    expect(closeCalls).toEqual([{ stopRuntime: false }]);
  });
});
