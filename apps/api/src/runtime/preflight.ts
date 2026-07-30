import { statfs } from "node:fs/promises";

import type {
  EngineManifest,
  NvidiaDevice,
  RuntimePreflight,
} from "@anima/runtime";

export interface RuntimePlatformFacts {
  platform: string;
  architecture: string;
  freeBytes: number;
  nvidiaDevices: NvidiaDevice[];
}

export interface RuntimePlatformProbe {
  inspect(storagePath: string): Promise<RuntimePlatformFacts>;
}

async function queryNvidiaDevices(): Promise<NvidiaDevice[]> {
  try {
    const process = Bun.spawn(
      [
        "nvidia-smi.exe",
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
        windowsHide: true,
      },
    );
    const output = await new Response(process.stdout).text();
    if ((await process.exited) !== 0) return [];
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.lastIndexOf(",");
        const rawVram = separator >= 0 ? line.slice(separator + 1).trim() : "";
        const parsedVram = Number.parseInt(rawVram, 10);
        return {
          name: separator >= 0 ? line.slice(0, separator).trim() : line,
          vramMiB: Number.isSafeInteger(parsedVram) ? parsedVram : null,
        };
      });
  } catch {
    return [];
  }
}

export class WindowsNvidiaPlatformProbe implements RuntimePlatformProbe {
  async inspect(storagePath: string): Promise<RuntimePlatformFacts> {
    const disk = await statfs(storagePath);
    return {
      platform: process.platform,
      architecture: process.arch,
      freeBytes: disk.bavail * disk.bsize,
      nvidiaDevices: await queryNvidiaDevices(),
    };
  }
}

export function evaluateRuntimePreflight(
  facts: RuntimePlatformFacts,
  manifest: EngineManifest,
): RuntimePreflight {
  const issues: RuntimePreflight["issues"] = [];
  if (facts.platform !== manifest.platform.os) {
    issues.push({
      code: "unsupported_platform",
      message: `Managed mode requires Windows; detected ${facts.platform}.`,
      blocking: true,
    });
  }
  if (facts.architecture !== manifest.platform.architecture) {
    issues.push({
      code: "unsupported_architecture",
      message: `Managed mode requires x64; detected ${facts.architecture}.`,
      blocking: true,
    });
  }
  if (facts.freeBytes < manifest.platform.minimumFreeBytes) {
    issues.push({
      code: "insufficient_disk",
      message: `Managed mode requires at least ${manifest.platform.minimumFreeBytes} free bytes.`,
      blocking: true,
    });
  }
  if (facts.nvidiaDevices.length === 0) {
    issues.push({
      code: "nvidia_unavailable",
      message: "No NVIDIA device was reported by nvidia-smi.",
      blocking: true,
    });
  } else if (
    facts.nvidiaDevices.every(
      (device) =>
        device.vramMiB !== null &&
        device.vramMiB < manifest.platform.recommendedVramMiB,
    )
  ) {
    issues.push({
      code: "low_vram",
      message: `At least ${manifest.platform.recommendedVramMiB} MiB VRAM is recommended.`,
      blocking: false,
    });
  }

  return {
    compatible: !issues.some((issue) => issue.blocking),
    platform: facts.platform,
    architecture: facts.architecture,
    freeBytes: facts.freeBytes,
    nvidiaDevices: facts.nvidiaDevices,
    issues,
  };
}
