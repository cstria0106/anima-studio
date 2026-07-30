import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import {
  MANAGED_ENGINE_MANIFEST,
  createRuntimeSbom,
  renderThirdPartyNotices,
  type EngineManifest,
  type InstalledRuntimeMarker,
  type RuntimeEvent,
  type RuntimeOperationKind,
  type RuntimePaths,
  type RuntimePreflight,
} from "@anima/runtime";

import {
  type ArtifactDownloader,
  ResumableArtifactDownloader,
} from "./download";
import { type ArchiveExtractor, TarArchiveExtractor } from "./extract";
import {
  evaluateRuntimePreflight,
  type RuntimePlatformProbe,
  WindowsNvidiaPlatformProbe,
} from "./preflight";
import {
  EmbeddedTrainingRuntimeProvisioner,
  type RuntimeProvisioner,
  validateManagedCustomNodeAllowlist,
} from "./provision";
import type { RuntimeStateRepository } from "./repository";

export const RUNTIME_MARKER_FILENAME = ".anima-runtime.json";
export const MODEL_PATHS_FILENAME = "extra_model_paths.yaml";

export interface RuntimeInstallResult {
  operationId: string;
  releaseRoot: string;
  marker: InstalledRuntimeMarker;
  preflight: RuntimePreflight;
  reused: boolean;
}

export interface RuntimeInstallerOptions {
  paths: RuntimePaths;
  repository: RuntimeStateRepository;
  manifest?: EngineManifest;
  platformProbe?: RuntimePlatformProbe;
  downloader?: ArtifactDownloader;
  extractor?: ArchiveExtractor;
  provisioner?: RuntimeProvisioner;
  now?: () => Date;
}

export class RuntimeInstallInProgressError extends Error {
  constructor() {
    super("A managed runtime installation is already in progress.");
    this.name = "RuntimeInstallInProgressError";
  }
}

export class RuntimePreflightError extends Error {
  constructor(readonly preflight: RuntimePreflight) {
    super(
      preflight.issues
        .filter((issue) => issue.blocking)
        .map((issue) => issue.message)
        .join(" "),
    );
    this.name = "RuntimePreflightError";
  }
}

function manifestDigest(manifest: EngineManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
}

function modelPathsYaml(paths: RuntimePaths): string {
  const base = paths.shared.replaceAll("\\", "/").replaceAll('"', '\\"');
  return [
    "anima:",
    `  base_path: "${base}"`,
    "  checkpoints: models/checkpoints",
    "  diffusion_models: models/diffusion_models",
    "  unet: models/unet",
    "  text_encoders: models/text_encoders",
    "  clip: models/clip",
    "  vae: models/vae",
    "  loras: models/loras",
    "",
  ].join("\n");
}

function event(
  operationId: string,
  operation: Extract<RuntimeOperationKind, "install" | "update" | "repair">,
  phase: string,
  message: string,
  now: () => Date,
  fields: Partial<
    Pick<
      RuntimeEvent,
      "level" | "progress" | "currentBytes" | "totalBytes" | "details"
    >
  > = {},
): RuntimeEvent {
  return {
    operationId,
    operation,
    phase,
    level: fields.level ?? "info",
    message,
    progress: fields.progress ?? null,
    currentBytes: fields.currentBytes ?? null,
    totalBytes: fields.totalBytes ?? null,
    createdAt: now().toISOString(),
    ...(fields.details ? { details: fields.details } : {}),
  };
}

async function readMarker(
  releaseRoot: string,
): Promise<InstalledRuntimeMarker | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(releaseRoot, RUNTIME_MARKER_FILENAME), "utf8"),
    ) as InstalledRuntimeMarker;
    return parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function assertSafeStagingPath(path: string, releases: string): void {
  const relativePath = relative(resolve(releases), resolve(path));
  if (
    !basename(path).startsWith(".staging-") ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(`${sep}${sep}`) ||
    resolve(path) === resolve(releases)
  ) {
    throw new Error("Refusing to clean an untrusted runtime staging path.");
  }
}

export class ManagedRuntimeInstaller {
  readonly manifest: EngineManifest;
  private readonly paths: RuntimePaths;
  private readonly repository: RuntimeStateRepository;
  private readonly platformProbe: RuntimePlatformProbe;
  private readonly downloader: ArtifactDownloader;
  private readonly extractor: ArchiveExtractor;
  private readonly provisioner: RuntimeProvisioner;
  private readonly now: () => Date;
  private active = false;

  constructor(options: RuntimeInstallerOptions) {
    this.paths = options.paths;
    this.repository = options.repository;
    this.manifest = options.manifest ?? MANAGED_ENGINE_MANIFEST;
    this.platformProbe =
      options.platformProbe ?? new WindowsNvidiaPlatformProbe();
    this.downloader =
      options.downloader ?? new ResumableArtifactDownloader();
    this.extractor = options.extractor ?? new TarArchiveExtractor();
    this.provisioner =
      options.provisioner ?? new EmbeddedTrainingRuntimeProvisioner();
    this.now = options.now ?? (() => new Date());
  }

  async preflight(): Promise<RuntimePreflight> {
    await mkdir(this.paths.root, { recursive: true });
    return evaluateRuntimePreflight(
      await this.platformProbe.inspect(this.paths.root),
      this.manifest,
    );
  }

  private async emit(value: RuntimeEvent): Promise<void> {
    await this.repository.appendEvent(value);
  }

  async install(
    options: {
      signal?: AbortSignal;
      operation?: Extract<
        RuntimeOperationKind,
        "install" | "update" | "repair"
      >;
      operationId?: string;
    } = {},
  ): Promise<RuntimeInstallResult> {
    if (this.active) throw new RuntimeInstallInProgressError();
    const operationId = options.operationId ?? crypto.randomUUID();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(operationId)) {
      throw new Error("Runtime operation ID contains unsupported characters.");
    }
    this.active = true;
    const releaseRoot = join(this.paths.releases, this.manifest.bundleId);
    const stagingRoot = join(
      this.paths.releases,
      `.staging-${this.manifest.bundleId}-${operationId}`,
    );
    const now = this.now;
    const operation = options.operation ?? "install";
    let preflight: RuntimePreflight | null = null;

    try {
      const currentState = await this.repository.getState();
      if (currentState?.mode === "external") {
        throw new Error(
          "Managed runtime installation is disabled in external ComfyUI mode.",
        );
      }
      await this.repository.patchState({
        status:
          operation === "repair"
            ? "repairing"
            : operation === "update"
              ? "updating"
              : "installing",
        operationId,
        error: null,
      });
      await this.emit(
        event(
          operationId,
          operation,
          "preflight",
          "Checking managed runtime requirements.",
          now,
        ),
      );
      preflight = await this.preflight();
      if (!preflight.compatible) throw new RuntimePreflightError(preflight);

      const existing = await readMarker(releaseRoot);
      const expectedDigest = manifestDigest(this.manifest);
      if (
        operation !== "repair" &&
        existing?.bundleId === this.manifest.bundleId &&
        existing.manifestSha256 === expectedDigest
      ) {
        await this.repository.patchState({
          status: "stopped",
          activeBundleId: this.manifest.bundleId,
          operationId: null,
          error: null,
        });
        await this.emit(
          event(
            operationId,
            operation,
            "complete",
            "Managed runtime is already installed.",
            now,
            { progress: 1 },
          ),
        );
        return {
          operationId,
          releaseRoot,
          marker: existing,
          preflight,
          reused: true,
        };
      }

      await mkdir(this.paths.downloads, { recursive: true });
      await mkdir(this.paths.releases, { recursive: true });
      await mkdir(this.paths.shared, { recursive: true });
      for (const directory of this.manifest.sharedDirectories) {
        await mkdir(join(this.paths.shared, directory), { recursive: true });
      }
      await writeFile(
        join(this.paths.shared, MODEL_PATHS_FILENAME),
        modelPathsYaml(this.paths),
        { encoding: "utf8", flag: "w" },
      );

      let releaseExists = false;
      try {
        await access(releaseRoot);
        releaseExists = true;
      } catch (error) {
        if (
          error instanceof Error &&
          !("code" in error && error.code === "ENOENT")
        ) {
          throw error;
        }
      }
      if (releaseExists) {
        if (operation !== "repair") {
          throw new Error(
            `Release destination already exists without a valid marker: ${releaseRoot}`,
          );
        }
        const quarantine = `${releaseRoot}.quarantine-${this.now().getTime()}-${crypto.randomUUID()}`;
        await rename(releaseRoot, quarantine);
        await this.emit(
          event(
            operationId,
            operation,
            "quarantine",
            "Moved the existing managed release to a recoverable quarantine slot.",
            now,
            { details: { quarantine } },
          ),
        );
      }

      await mkdir(stagingRoot, { recursive: false });
      const totalBytes = this.manifest.artifacts.reduce(
        (sum, artifact) => sum + artifact.bytes,
        0,
      );
      let completedBytes = 0;
      for (const artifact of this.manifest.artifacts) {
        options.signal?.throwIfAborted();
        await this.emit(
          event(
            operationId,
            operation,
            "download",
            `Downloading ${artifact.name}.`,
            now,
            {
              currentBytes: completedBytes,
              totalBytes,
              progress: completedBytes / totalBytes,
              details: { artifactId: artifact.id },
            },
          ),
        );
        const archivePath = await this.downloader.download(
          artifact,
          this.paths.downloads,
          {
            ...(options.signal ? { signal: options.signal } : {}),
            onProgress: (progress) => {
              const currentBytes = completedBytes + progress.currentBytes;
              void this.emit(
                event(
                  operationId,
                  operation,
                  "download",
                  `Downloading ${artifact.name}.`,
                  now,
                  {
                    currentBytes,
                    totalBytes,
                    progress: currentBytes / totalBytes,
                    details: { artifactId: artifact.id },
                  },
                ),
              );
            },
          },
        );
        completedBytes += artifact.bytes;
        await this.emit(
          event(
            operationId,
            operation,
            "extract",
            `Installing ${artifact.name}.`,
            now,
            {
              currentBytes: completedBytes,
              totalBytes,
              progress: completedBytes / totalBytes,
              details: { artifactId: artifact.id },
            },
          ),
        );
        await this.extractor.extract(artifact, archivePath, stagingRoot);
      }
      await this.emit(
        event(
          operationId,
          operation,
          "provision",
          "Preparing pinned Python and custom-node dependencies.",
          now,
        ),
      );
      await this.provisioner.provision({
        manifest: this.manifest,
        releaseRoot: stagingRoot,
        paths: this.paths,
        ...(options.signal ? { signal: options.signal } : {}),
        onLog: (message) => {
          void this.emit(
            event(operationId, operation, "provision", message, now),
          );
        },
      });
      if (
        this.manifest.artifacts.some(
          (artifact) => artifact.id === "comfyui",
        )
      ) {
        await validateManagedCustomNodeAllowlist(stagingRoot);
      }

      const marker: InstalledRuntimeMarker = {
        schemaVersion: 1,
        bundleId: this.manifest.bundleId,
        installedAt: now().toISOString(),
        manifestSha256: expectedDigest,
        artifacts: this.manifest.artifacts.map((artifact) => ({
          id: artifact.id,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
        })),
      };
      await Promise.all([
        writeFile(
          join(stagingRoot, "THIRD_PARTY_NOTICES.md"),
          `${renderThirdPartyNotices(this.manifest)}\n`,
          { encoding: "utf8", flag: "wx" },
        ),
        writeFile(
          join(stagingRoot, "runtime.cdx.json"),
          `${JSON.stringify(createRuntimeSbom(this.manifest), null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        ),
      ]);
      await writeFile(
        join(stagingRoot, RUNTIME_MARKER_FILENAME),
        `${JSON.stringify(marker, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await rename(stagingRoot, releaseRoot);
      await this.repository.patchState({
        status: "stopped",
        activeBundleId: this.manifest.bundleId,
        operationId: null,
        error: null,
      });
      await this.emit(
        event(
          operationId,
          operation,
          "complete",
          "Managed runtime installation completed.",
          now,
          {
            progress: 1,
            currentBytes: totalBytes,
            totalBytes,
          },
        ),
      );
      return {
        operationId,
        releaseRoot,
        marker,
        preflight,
        reused: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Managed runtime installation failed.";
      await this.repository.patchState({
        status: "failed",
        operationId: null,
        error: message,
      });
      await this.emit(
        event(operationId, operation, "failed", message, now, {
          level: "error",
        }),
      );
      try {
        assertSafeStagingPath(stagingRoot, this.paths.releases);
        await rm(stagingRoot, { recursive: true, force: true });
      } catch {
        // Installation failure remains primary; staging cleanup is best effort.
      }
      throw error;
    } finally {
      this.active = false;
    }
  }
}
