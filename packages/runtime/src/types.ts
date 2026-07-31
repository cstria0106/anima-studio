export const RUNTIME_STATES = [
  "not_installed",
  "installing",
  "stopped",
  "starting",
  "ready",
  "stopping",
  "updating",
  "repairing",
  "failed",
] as const;

export type RuntimeStatus = (typeof RUNTIME_STATES)[number];
export type RuntimeMode = "managed" | "external";
export type RuntimeOperationKind =
  | "install"
  | "start"
  | "stop"
  | "restart"
  | "update"
  | "repair";

export type ArchiveFormat = "7z" | "zip" | "tar.gz" | "raw";
export type EngineArtifactKind =
  | "engine"
  | "custom-node"
  | "training-runtime"
  | "tool"
  | "tagger-model";

export interface EngineArtifact {
  id: string;
  kind: EngineArtifactKind;
  name: string;
  version: string;
  revision: string;
  downloadUrl: string;
  sourceUrl: string;
  bytes: number;
  sha256: string;
  license: string;
  archive: {
    format: ArchiveFormat;
    stripComponents: number;
  };
  destination: string;
}

export interface EngineLaunchManifest {
  executable: string;
  entrypoint: string;
  arguments: string[];
  host: "127.0.0.1";
  portRange: {
    from: number;
    to: number;
  };
  readinessTimeoutMs: number;
}

export interface EngineManifest {
  schemaVersion: 1;
  bundleId: string;
  displayName: string;
  platform: {
    os: "win32";
    architecture: "x64";
    accelerator: "nvidia";
    minimumFreeBytes: number;
    recommendedVramMiB: number;
  };
  launch: EngineLaunchManifest;
  sharedDirectories: readonly string[];
  artifacts: readonly EngineArtifact[];
}

export interface RuntimePaths {
  root: string;
  releases: string;
  downloads: string;
  shared: string;
  logs: string;
  input: string;
  output: string;
  temp: string;
  user: string;
  models: string;
  cache: string;
}

export interface NvidiaDevice {
  name: string;
  vramMiB: number | null;
}

export interface RuntimePreflight {
  compatible: boolean;
  platform: string;
  architecture: string;
  freeBytes: number;
  nvidiaDevices: NvidiaDevice[];
  issues: Array<{
    code:
      | "unsupported_platform"
      | "unsupported_architecture"
      | "insufficient_disk"
      | "nvidia_unavailable"
      | "low_vram"
      | "runtime_path_too_long";
    message: string;
    blocking: boolean;
  }>;
}

export interface OwnedRuntimeProcess {
  pid: number;
  executable: string;
  entrypoint: string;
  releaseRoot: string;
  startedAt: string;
  port: number;
  sessionId: string;
}

export interface RuntimeState {
  mode: RuntimeMode;
  status: RuntimeStatus;
  endpoint: string;
  port: number | null;
  activeBundleId: string | null;
  operationId: string | null;
  process: OwnedRuntimeProcess | null;
  error: string | null;
  updatedAt: string;
}

export interface RuntimeEvent {
  operationId: string;
  operation: RuntimeOperationKind;
  phase: string;
  level: "info" | "warning" | "error";
  message: string;
  progress: number | null;
  currentBytes: number | null;
  totalBytes: number | null;
  createdAt: string;
  details?: Record<string, unknown>;
}

export interface InstalledRuntimeMarker {
  schemaVersion: 1;
  bundleId: string;
  installedAt: string;
  manifestSha256: string;
  artifacts: Array<{
    id: string;
    sha256: string;
    bytes: number;
  }>;
}
