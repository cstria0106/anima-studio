import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import type {
  CivitaiInspectDto,
  HuggingFaceAnimaCatalogDto,
  HuggingFaceAnimaInstallDto,
  ManagedModelInstallationDto,
  ModelDownloadDto,
  ModelInstallationStatus,
} from "@anima/shared";

import type { CivitaiModelLibraryService } from "../civitai";
import {
  CivitaiError,
  DestinationRegistry,
  NodeFileHasher,
  sha256Matches,
} from "../civitai";
import type { StudioRepository } from "../db/repository";
import type { HuggingFaceAnimaLibraryService } from "../huggingface";

type DownloadSettler = Pick<
  CivitaiModelLibraryService | HuggingFaceAnimaLibraryService,
  "settled"
>;

interface InstallChild {
  downloadId: string;
  installationId: string;
  provider: ModelDownloadDto["provider"];
  providerModelId: string;
  providerVersionId: string;
  providerFileId: string | null;
}

interface ActiveInstall {
  installationId: string;
  children: InstallChild[];
  status: "installing" | "installed" | "failed";
  progress: number;
  error?: string;
  completion: Promise<void>;
}

const recommendedAnimaModels = new Set([
  "anima-base-v1.0.safetensors",
  "anima-turbo-v1.0.safetensors",
  "anima-aesthetic-v1.1.safetensors",
]);

function taskDto(task: ActiveInstall): HuggingFaceAnimaInstallDto {
  return {
    installationId: task.installationId,
    status: task.status,
    progress: task.progress,
    ...(task.error ? { error: task.error } : {}),
  };
}

function downloadProgress(download: ModelDownloadDto): number {
  if (download.state === "completed") return 100;
  if (download.state === "verifying" || download.state === "indexing") {
    return 99;
  }
  if (download.bytesTotal && download.bytesTotal > 0) {
    return Math.min(
      98,
      Math.max(0, (download.bytesCompleted / download.bytesTotal) * 100),
    );
  }
  return download.state === "resolving" ? 0 : 1;
}

function storagePathKey(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

/**
 * Keeps durable installation state separate from transient provider download
 * rows. Provider services may use model_downloads while work is active, but
 * this coordinator always removes the download and operation records after a
 * terminal result.
 */
export class ModelDownloadCoordinator {
  private readonly tasks = new Map<string, ActiveInstall>();
  private readonly childReferences = new Map<string, number>();
  private readonly childInstallationIds = new Map<string, string>();

  constructor(
    private readonly repository: StudioRepository,
    private readonly civitai: DownloadSettler,
    private readonly huggingFace: DownloadSettler,
    private readonly destinations: DestinationRegistry,
    private readonly removalStagingRoot: string,
    private readonly hasher = new NodeFileHasher(),
    private readonly onInstallationsChanged: () => void = () => undefined,
  ) {
    if (!isAbsolute(removalStagingRoot)) {
      throw new Error("Model removal staging must use an absolute path.");
    }
    this.removalStagingRoot = resolve(removalStagingRoot);
    if (resolve(this.removalStagingRoot, "..") === this.removalStagingRoot) {
      throw new Error("Model removal staging cannot be a filesystem root.");
    }
  }

  /**
   * Task handles are process-local. Clear interrupted rows before accepting
   * new work; provider-owned deterministic .part files remain available for
   * the next install request to resume.
   */
  discardInterruptedTasks(): void {
    for (const row of this.repository.listModelDownloadRows()) {
      this.repository.deleteModelDownloadTask(row.id);
    }
  }

  async reconcileInstallations(): Promise<void> {
    this.discardInterruptedTasks();
    for (const installation of this.repository.listManagedModelInstallations()) {
      try {
        const destination = this.destinations.resolveKind(
          installation.destinationRootId,
          installation.destinationRootId,
          installation.relativeDir,
        );
        const filePath = await this.destinations.verifyFinalFile(
          destination,
          installation.storagePath,
        );
        const actualSha256 = await this.hasher.sha256(filePath);
        if (!sha256Matches(installation.sha256, actualSha256)) {
          throw new Error("Installed model hash changed.");
        }
      } catch {
        this.repository.deleteManagedModelInstallation(installation.id);
      }
    }
  }

  listInstallations(
    provider?: ManagedModelInstallationDto["provider"],
    destinationRootId?: ManagedModelInstallationDto["destinationRootId"],
  ): ManagedModelInstallationDto[] {
    return this.repository
      .listManagedModelInstallations()
      .filter(
        (installation) =>
          (!provider || installation.provider === provider) &&
          (!destinationRootId ||
            installation.destinationRootId === destinationRootId),
      );
  }

  track(
    downloads: ModelDownloadDto[],
    primaryDownloadId: string,
  ): HuggingFaceAnimaInstallDto {
    const primary = downloads.find(
      (download) => download.id === primaryDownloadId,
    );
    if (!primary) {
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The primary model installation task was not found.",
        500,
      );
    }
    const existing = this.findActiveByIdentity(
      primary.provider,
      primary.providerModelId,
      primary.providerVersionId,
      primary.providerFileId,
    );
    if (existing) return taskDto(existing);

    const uniqueDownloads = [
      ...new Map(downloads.map((download) => [download.id, download])).values(),
    ];
    if (!this.repository.findModelDownloadRow(primary.id)) {
      const installed = this.findInstalled(
        primary.provider,
        primary.providerModelId,
        primary.providerVersionId,
        primary.providerFileId,
      );
      if (installed) {
        return {
          installationId: installed.id,
          status: "installed",
          progress: 100,
        };
      }
    }
    const pendingDownloads = uniqueDownloads.filter(
      (download) =>
        this.repository.findModelDownloadRow(download.id) ||
        !this.findInstalled(
          download.provider,
          download.providerModelId,
          download.providerVersionId,
          download.providerFileId,
        ),
    );
    const children = pendingDownloads.map((download) => {
      const installationId =
        this.childInstallationIds.get(download.id) ?? crypto.randomUUID();
      this.childInstallationIds.set(download.id, installationId);
      return {
        downloadId: download.id,
        installationId,
        provider: download.provider,
        providerModelId: download.providerModelId,
        providerVersionId: download.providerVersionId,
        providerFileId: download.providerFileId,
      };
    });
    const primaryChild = children.find(
      (child) => child.downloadId === primary.id,
    )!;
    const task: ActiveInstall = {
      installationId: primaryChild.installationId,
      children,
      status: "installing",
      progress: 0,
      completion: Promise.resolve(),
    };
    for (const child of children) {
      this.childReferences.set(
        child.downloadId,
        (this.childReferences.get(child.downloadId) ?? 0) + 1,
      );
    }
    this.tasks.set(task.installationId, task);
    task.completion = this.settle(task);
    return taskDto(task);
  }

  getTask(installationId: string): HuggingFaceAnimaInstallDto {
    const task = this.tasks.get(installationId);
    if (!task) {
      const installation =
        this.repository.findManagedModelInstallation(installationId);
      if (installation) {
        return {
          installationId,
          status: "installed",
          progress: 100,
        };
      }
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The model installation task was not found.",
        404,
      );
    }
    if (task.status === "installing") {
      const progress = task.children.map((child) => {
        const download = this.repository.findModelDownload(child.downloadId);
        return download ? downloadProgress(download) : 0;
      });
      task.progress =
        progress.length > 0
          ? progress.reduce((total, value) => total + value, 0) /
            progress.length
          : 0;
    }
    return taskDto(task);
  }

  async settledTask(
    installationId: string,
  ): Promise<HuggingFaceAnimaInstallDto> {
    const task = this.tasks.get(installationId);
    if (task) await task.completion;
    return this.getTask(installationId);
  }

  current(
    provider: ModelDownloadDto["provider"],
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string | null,
  ): HuggingFaceAnimaInstallDto | null {
    const active = this.findActiveByIdentity(
      provider,
      providerModelId,
      providerVersionId,
      providerFileId,
    );
    if (active) return this.getTask(active.installationId);
    const installed =
      this.findInstalled(
        provider,
        providerModelId,
        providerVersionId,
        providerFileId,
      );
    return installed
      ? {
          installationId: installed.id,
          status: "installed",
          progress: 100,
        }
      : null;
  }

  decorateCivitai(model: CivitaiInspectDto): CivitaiInspectDto {
    return {
      ...model,
      versions: model.versions.map((version) => ({
        ...version,
        files: version.files.map((file) => ({
          ...file,
          ...this.stateFor(
            "civitai",
            String(model.modelId),
            String(version.id),
            String(file.id),
          ),
        })),
      })),
    };
  }

  decorateAnima(
    catalog: HuggingFaceAnimaCatalogDto,
  ): HuggingFaceAnimaCatalogDto {
    return {
      ...catalog,
      files: catalog.files
        .filter(
          (file) =>
            file.kind !== "diffusion_model" ||
            (file.recommended &&
              !file.experimental &&
              recommendedAnimaModels.has(file.filename.toLowerCase())),
        )
        .map((file) => ({
          ...file,
          ...this.stateFor(
            "huggingface",
            catalog.repository,
            catalog.revision,
            file.path,
          ),
        })),
    };
  }

  async remove(id: string): Promise<ManagedModelInstallationDto> {
    const installation =
      this.repository.findManagedModelInstallation(id);
    if (!installation) {
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The managed model installation was not found.",
        404,
      );
    }
    const destination = this.destinations.resolveKind(
      installation.destinationRootId,
      installation.destinationRootId,
      installation.relativeDir,
    );
    const registeredFilePath = this.destinations.assertFinalFile(
      destination,
      installation.storagePath,
    );
    if (
      this.findActiveByIdentity(
        installation.provider,
        installation.providerModelId,
        installation.providerVersionId,
        installation.providerFileId,
      ) ||
      this.activeInstallTargets(registeredFilePath)
    ) {
      throw new CivitaiError(
        "DOWNLOAD_FAILED",
        "The model is currently being installed.",
        409,
      );
    }

    const filePath = await this.destinations.verifyFinalFile(
      destination,
      registeredFilePath,
    );
    const actualSha256 = await this.hasher.sha256(filePath);
    if (!sha256Matches(installation.sha256, actualSha256)) {
      throw new CivitaiError(
        "HASH_MISMATCH",
        "The installed file has changed and was not removed.",
        409,
      );
    }

    await mkdir(this.removalStagingRoot, { recursive: true });
    const stagingRootStats = await lstat(this.removalStagingRoot);
    if (
      !stagingRootStats.isDirectory() ||
      stagingRootStats.isSymbolicLink()
    ) {
      throw new CivitaiError(
        "DOWNLOAD_FAILED",
        "The model removal staging directory is not safe.",
        500,
      );
    }
    const stagedPath = join(
      this.removalStagingRoot,
      `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}-${basename(filePath)}`,
    );
    await rename(filePath, stagedPath);
    let stagedRemoved = false;
    try {
      const stagedStats = await lstat(stagedPath);
      if (!stagedStats.isFile() || stagedStats.isSymbolicLink()) {
        throw new CivitaiError(
          "DOWNLOAD_FAILED",
          "The installed file changed during removal and was not removed.",
          409,
        );
      }
      const stagedSha256 = await this.hasher.sha256(stagedPath);
      if (!sha256Matches(installation.sha256, stagedSha256)) {
        throw new CivitaiError(
          "HASH_MISMATCH",
          "The installed file changed and was not removed.",
          409,
        );
      }
      await rm(stagedPath, { force: true });
      stagedRemoved = true;
      if (!this.repository.deleteManagedModelInstallation(id)) {
        throw new Error("The managed installation record disappeared.");
      }
      this.onInstallationsChanged();
    } catch (error) {
      if (!stagedRemoved) {
        try {
          await rename(stagedPath, filePath);
        } catch {
          throw new CivitaiError(
            "DOWNLOAD_FAILED",
            "The model file could not be restored after removal failed.",
            500,
          );
        }
      }
      throw error;
    }
    return installation;
  }

  private stateFor(
    provider: ModelDownloadDto["provider"],
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string | null,
  ): {
    installationId: string | null;
    installationStatus: ModelInstallationStatus;
    installationProgress: number | null;
  } {
    const active = this.findActiveByIdentity(
      provider,
      providerModelId,
      providerVersionId,
      providerFileId,
    );
    if (active?.status === "installing") {
      const current = this.getTask(active.installationId);
      return {
        installationId: active.installationId,
        installationStatus: "installing",
        installationProgress: current.progress,
      };
    }
    const installed =
      this.findInstalled(
        provider,
        providerModelId,
        providerVersionId,
        providerFileId,
      );
    return installed
      ? {
          installationId: installed.id,
          installationStatus: "installed",
          installationProgress: 100,
        }
      : {
          installationId: null,
          installationStatus: "not_installed",
          installationProgress: null,
        };
  }

  private findActiveByIdentity(
    provider: ModelDownloadDto["provider"],
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string | null,
  ): ActiveInstall | null {
    for (const task of this.tasks.values()) {
      if (
        task.status === "installing" &&
        task.children.some(
          (child) =>
            child.provider === provider &&
            child.providerModelId === providerModelId &&
            child.providerVersionId === providerVersionId &&
            child.providerFileId === providerFileId,
        )
      ) {
        return task;
      }
    }
    return null;
  }

  private findInstalled(
    provider: ModelDownloadDto["provider"],
    providerModelId: string,
    providerVersionId: string,
    providerFileId: string | null,
  ): ManagedModelInstallationDto | null {
    const exact =
      this.repository.findManagedModelInstallationByProviderFile(
        provider,
        providerModelId,
        providerVersionId,
        providerFileId,
      );
    if (exact || provider !== "huggingface" || providerFileId === null) {
      return exact;
    }
    return this.repository.findManagedModelInstallationByProviderArtifact(
      provider,
      providerModelId,
      providerFileId,
    );
  }

  private activeInstallTargets(filePath: string): boolean {
    const target = storagePathKey(filePath);
    for (const task of this.tasks.values()) {
      if (task.status !== "installing") continue;
      for (const child of task.children) {
        const download = this.repository.findModelDownload(
          child.downloadId,
        );
        if (!download) continue;
        const row = this.repository.findModelDownloadRow(
          child.downloadId,
        );
        try {
          const destination = this.destinations.resolveKind(
            download.destinationRootId,
            download.destinationRootId,
            download.relativeDir,
          );
          const candidate =
            row?.storagePath ??
            join(destination.absoluteDirectory, download.filename);
          if (storagePathKey(candidate) === target) return true;
        } catch {
          // Invalid active rows fail through their owning installation task.
        }
      }
    }
    return false;
  }

  private serviceFor(provider: ModelDownloadDto["provider"]): DownloadSettler {
    return provider === "huggingface" ? this.huggingFace : this.civitai;
  }

  private async settle(task: ActiveInstall): Promise<void> {
    try {
      await Promise.allSettled(
        task.children.map((child) =>
          this.serviceFor(child.provider).settled(child.downloadId),
        ),
      );
      const completed = task.children.map((child) => ({
        child,
        download: this.repository.findModelDownload(child.downloadId),
        row: this.repository.findModelDownloadRow(child.downloadId),
      }));
      const invalid = completed.find(
        ({ download, row }) =>
          !download ||
          download.state !== "completed" ||
          !row?.storagePath ||
          !download.actualSha256 ||
          (download.expectedSha256 !== null &&
            !sha256Matches(
              download.expectedSha256,
              download.actualSha256,
            )),
      );
      if (invalid) {
        task.status = "failed";
        task.progress = 0;
        task.error =
          invalid.download?.error ??
          "The model installation did not complete.";
        return;
      }

      this.repository.upsertManagedModelInstallations(
        completed.map(({ child, download, row }) => ({
          id: child.installationId,
          provider: download!.provider,
          sourceUrl:
            typeof download!.metadata.sourceUrl === "string"
              ? download!.metadata.sourceUrl
              : download!.provider === "civitai"
                ? `https://civitai.com/models/${download!.providerModelId}?modelVersionId=${download!.providerVersionId}`
                : null,
          providerModelId: download!.providerModelId,
          providerVersionId: download!.providerVersionId,
          providerFileId: download!.providerFileId,
          modelName: download!.modelName,
          versionName: download!.versionName,
          filename: download!.filename,
          destinationRootId: download!.destinationRootId,
          relativeDir: download!.relativeDir,
          sha256: download!.actualSha256!,
          storagePath: row!.storagePath!,
          ...(download!.completedAt
            ? { installedAt: download!.completedAt }
            : {}),
        })),
      );
      // Invalidate dependent model-option caches before exposing the terminal
      // state to SSE consumers. Otherwise the UI can immediately refetch the
      // still-cached pre-install list and remain stale until a page refresh.
      this.onInstallationsChanged();
      task.status = "installed";
      task.progress = 100;
    } catch {
      task.status = "failed";
      task.progress = 0;
      task.error = "The model installation could not be saved.";
    } finally {
      for (const child of task.children) {
        const references =
          this.childReferences.get(child.downloadId) ?? 0;
        if (references > 1) {
          this.childReferences.set(child.downloadId, references - 1);
          continue;
        }
        this.childReferences.delete(child.downloadId);
        this.childInstallationIds.delete(child.downloadId);
        try {
          this.repository.deleteModelDownloadTask(child.downloadId);
        } catch {
          // Startup reconciliation removes any terminal row left behind.
        }
      }
      const retention = setTimeout(() => {
        this.tasks.delete(task.installationId);
      }, 60_000);
      retention.unref?.();
    }
  }
}
