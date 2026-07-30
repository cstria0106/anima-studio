import { isAbsolute, normalize, sep } from "node:path";

import type {
  ArchiveFormat,
  EngineArtifact,
  EngineArtifactKind,
  EngineManifest,
} from "./types";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const ARTIFACT_KINDS = new Set<EngineArtifactKind>([
  "engine",
  "custom-node",
  "training-runtime",
  "tool",
  "tagger-model",
]);
const ARCHIVE_FORMATS = new Set<ArchiveFormat>([
  "7z",
  "zip",
  "tar.gz",
  "raw",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
  return value as number;
}

function httpsUrl(value: unknown, label: string): string {
  const result = text(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return result;
}

export function assertSafeRelativePath(value: string, label: string): void {
  if (value.length === 0 || isAbsolute(value) || /^[a-z]:/i.test(value)) {
    throw new Error(`${label} must be a relative path.`);
  }
  const normalized = normalize(value);
  if (
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.split(sep).includes("..")
  ) {
    throw new Error(`${label} must not escape its runtime root.`);
  }
}

function artifact(value: unknown, index: number): EngineArtifact {
  const item = record(value, `artifacts[${index}]`);
  const prefix = `artifacts[${index}]`;
  const id = text(item.id, `${prefix}.id`);
  if (!SAFE_ID.test(id)) {
    throw new Error(`${prefix}.id contains unsupported characters.`);
  }
  const kind = text(item.kind, `${prefix}.kind`) as EngineArtifactKind;
  if (!ARTIFACT_KINDS.has(kind)) {
    throw new Error(`${prefix}.kind is unsupported.`);
  }
  const sha256 = text(item.sha256, `${prefix}.sha256`);
  if (!SHA256.test(sha256)) {
    throw new Error(`${prefix}.sha256 must be a lowercase SHA-256 digest.`);
  }
  const revision = text(item.revision, `${prefix}.revision`);
  if (!GIT_REVISION.test(revision)) {
    throw new Error(`${prefix}.revision must be a full 40-character commit.`);
  }
  const archiveValue = record(item.archive, `${prefix}.archive`);
  const format = text(
    archiveValue.format,
    `${prefix}.archive.format`,
  ) as ArchiveFormat;
  if (!ARCHIVE_FORMATS.has(format)) {
    throw new Error(`${prefix}.archive.format is unsupported.`);
  }
  const destination = text(item.destination, `${prefix}.destination`);
  if (destination !== ".") {
    assertSafeRelativePath(destination, `${prefix}.destination`);
  }
  const downloadUrl = httpsUrl(item.downloadUrl, `${prefix}.downloadUrl`);
  if (/\/latest(?:\/|$)|[?&](?:ref|version)=latest(?:&|$)/i.test(downloadUrl)) {
    throw new Error(`${prefix}.downloadUrl must be immutable, not latest.`);
  }

  return {
    id,
    kind,
    name: text(item.name, `${prefix}.name`),
    version: text(item.version, `${prefix}.version`),
    revision,
    downloadUrl,
    sourceUrl: httpsUrl(item.sourceUrl, `${prefix}.sourceUrl`),
    bytes: integer(item.bytes, `${prefix}.bytes`, 1),
    sha256,
    license: text(item.license, `${prefix}.license`),
    archive: {
      format,
      stripComponents: integer(
        archiveValue.stripComponents,
        `${prefix}.archive.stripComponents`,
      ),
    },
    destination,
  };
}

export function validateEngineManifest(value: unknown): EngineManifest {
  const input = record(value, "manifest");
  if (input.schemaVersion !== 1) {
    throw new Error("manifest.schemaVersion must be 1.");
  }
  const bundleId = text(input.bundleId, "manifest.bundleId");
  if (!SAFE_ID.test(bundleId)) {
    throw new Error("manifest.bundleId contains unsupported characters.");
  }
  const platform = record(input.platform, "manifest.platform");
  if (platform.os !== "win32") {
    throw new Error("manifest.platform.os must be win32.");
  }
  if (platform.architecture !== "x64") {
    throw new Error("manifest.platform.architecture must be x64.");
  }
  if (platform.accelerator !== "nvidia") {
    throw new Error("manifest.platform.accelerator must be nvidia.");
  }
  const launch = record(input.launch, "manifest.launch");
  if (launch.host !== "127.0.0.1") {
    throw new Error("manifest.launch.host must remain loopback-only.");
  }
  const portRange = record(launch.portRange, "manifest.launch.portRange");
  const portFrom = integer(portRange.from, "manifest.launch.portRange.from", 1);
  const portTo = integer(portRange.to, "manifest.launch.portRange.to", 1);
  if (portFrom > portTo || portTo > 65_535) {
    throw new Error("manifest.launch.portRange is invalid.");
  }
  const executable = text(launch.executable, "manifest.launch.executable");
  const entrypoint = text(launch.entrypoint, "manifest.launch.entrypoint");
  assertSafeRelativePath(executable, "manifest.launch.executable");
  assertSafeRelativePath(entrypoint, "manifest.launch.entrypoint");
  if (!Array.isArray(launch.arguments)) {
    throw new Error("manifest.launch.arguments must be an array.");
  }
  const launchArguments = launch.arguments.map((argument, index) =>
    text(argument, `manifest.launch.arguments[${index}]`),
  );
  if (launchArguments.some((argument) => /--enable-cors-header/i.test(argument))) {
    throw new Error("Managed ComfyUI must not enable CORS.");
  }
  if (launchArguments.some((argument) => argument === "--fast")) {
    throw new Error("Managed ComfyUI must not use --fast.");
  }

  if (!Array.isArray(input.sharedDirectories)) {
    throw new Error("manifest.sharedDirectories must be an array.");
  }
  const sharedDirectories = input.sharedDirectories.map((path, index) => {
    const result = text(path, `manifest.sharedDirectories[${index}]`);
    assertSafeRelativePath(result, `manifest.sharedDirectories[${index}]`);
    return result;
  });
  if (new Set(sharedDirectories).size !== sharedDirectories.length) {
    throw new Error("manifest.sharedDirectories contains duplicates.");
  }

  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new Error("manifest.artifacts must contain at least one artifact.");
  }
  const artifacts = input.artifacts.map(artifact);
  if (new Set(artifacts.map((item) => item.id)).size !== artifacts.length) {
    throw new Error("manifest.artifacts contains duplicate IDs.");
  }
  if (artifacts.filter((item) => item.kind === "engine").length !== 1) {
    throw new Error("manifest.artifacts must contain exactly one engine.");
  }

  return {
    schemaVersion: 1,
    bundleId,
    displayName: text(input.displayName, "manifest.displayName"),
    platform: {
      os: "win32",
      architecture: "x64",
      accelerator: "nvidia",
      minimumFreeBytes: integer(
        platform.minimumFreeBytes,
        "manifest.platform.minimumFreeBytes",
        1,
      ),
      recommendedVramMiB: integer(
        platform.recommendedVramMiB,
        "manifest.platform.recommendedVramMiB",
        1,
      ),
    },
    launch: {
      executable,
      entrypoint,
      arguments: launchArguments,
      host: "127.0.0.1",
      portRange: { from: portFrom, to: portTo },
      readinessTimeoutMs: integer(
        launch.readinessTimeoutMs,
        "manifest.launch.readinessTimeoutMs",
        1_000,
      ),
    },
    sharedDirectories,
    artifacts,
  };
}
