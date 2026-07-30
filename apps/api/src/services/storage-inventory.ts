import {
  lstat,
  mkdir,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  storageCleanupRequestSchema,
  storageItemKinds,
  type StorageCleanupResultDto,
  type StorageInventoryDto,
  type StorageItemDto,
} from "@anima/shared";
import type {
  ModelDownloadRow,
} from "../db/schema";
import { StudioRepository } from "../db/repository";
import { JobSubmissionError } from "./jobs";

function pathInside(root: string, candidate: string): boolean {
  const base = resolve(root);
  const child = resolve(candidate);
  const value = relative(base, child);
  return (
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class StorageInventoryService {
  private readonly dataRoot: string;
  private readonly previewRoot: string;
  private readonly modelRoots: string[];

  constructor(
    private readonly repository: StudioRepository,
    options: { dataDir: string; modelRoots: string[] },
  ) {
    this.dataRoot = resolve(options.dataDir);
    this.previewRoot = resolve(this.dataRoot, "previews");
    this.modelRoots = options.modelRoots.map((root) => resolve(root));
  }

  private async regularFileSize(path: string): Promise<number | null> {
    try {
      const stats = await lstat(path);
      return stats.isFile() && !stats.isSymbolicLink() ? stats.size : null;
    } catch {
      return null;
    }
  }

  private async previewItems(): Promise<StorageItemDto[]> {
    let names: string[];
    try {
      names = await readdir(this.previewRoot);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "ENOENT") return [];
      throw error;
    }
    const items: StorageItemDto[] = [];
    for (const name of names) {
      if (!name.endsWith(".preview")) continue;
      const id = name.slice(0, -".preview".length);
      const path = resolve(this.previewRoot, name);
      if (!pathInside(this.previewRoot, path)) continue;
      const size = await this.regularFileSize(path);
      if (size === null) continue;
      const job = this.repository.findJobRow(id);
      const active = job ? !this.repository.isTerminal(job) : false;
      const stats = await lstat(path);
      items.push({
        kind: "preview",
        id,
        name: `${id}.preview`,
        byteSize: size,
        createdAt: stats.mtime.toISOString(),
        dependencies:
          active && job
            ? [
                {
                  kind: "job",
                  id: job.id,
                  label: "Active generation preview",
                },
              ]
            : [],
        cleanupEligible: !active,
        cleanupReason: active
          ? "A running generation is still writing this preview."
          : null,
      });
    }
    return items;
  }

  private modelPath(row: ModelDownloadRow): string | null {
    if (!row.storagePath) return null;
    const candidate = resolve(row.storagePath);
    return this.modelRoots.some((root) => pathInside(root, candidate))
      ? candidate
      : null;
  }

  async inventory(): Promise<StorageInventoryDto> {
    const assetItems: StorageItemDto[] = this.repository
      .listAssetRows()
      .map((row) => {
        const dependencies = this.repository.assetDependencies(row.id);
        return {
          kind: "asset",
          id: row.id,
          name: row.originalName,
          byteSize: row.byteSize,
          createdAt: row.createdAt,
          dependencies,
          cleanupEligible: dependencies.length === 0,
          cleanupReason:
            dependencies.length > 0
              ? "This reference image is used by a profile or generation."
              : null,
        };
      });
    const outputItems: StorageItemDto[] = this.repository
      .listOutputRows()
      .map((row) => {
        const dependencies = this.repository.outputDependencies(row.id);
        return {
          kind: "output",
          id: row.id,
          name: row.filename,
          byteSize: row.byteSize,
          createdAt: row.createdAt,
          dependencies,
          cleanupEligible: dependencies.length === 0,
          cleanupReason:
            dependencies.length > 0
              ? "This result is used as a representative image or upscale source."
              : null,
        };
      });
    const modelItems: StorageItemDto[] = [];
    for (const row of this.repository.listModelDownloadRows()) {
      const path = this.modelPath(row);
      const fileSize = path ? await this.regularFileSize(path) : null;
      const dependencies = this.repository.modelDependencies(row.filename);
      const completed = row.state === "completed";
      const eligible =
        completed &&
        path !== null &&
        fileSize !== null &&
        dependencies.length === 0;
      let cleanupReason: string | null = null;
      if (!completed) cleanupReason = "Only completed downloads can be cleaned up.";
      else if (!path) cleanupReason = "The model is outside managed model storage.";
      else if (fileSize === null) cleanupReason = "The downloaded model file is unavailable.";
      else if (dependencies.length > 0) {
        cleanupReason =
          "A saved model pack or active generation uses this model.";
      }
      modelItems.push({
        kind: "model_download",
        id: row.id,
        name: row.filename,
        byteSize: fileSize ?? 0,
        createdAt: row.createdAt,
        dependencies,
        cleanupEligible: eligible,
        cleanupReason,
      });
    }
    const items = [
      ...assetItems,
      ...outputItems,
      ...(await this.previewItems()),
      ...modelItems,
    ];
    const categories = storageItemKinds.map((kind) => {
      const matches = items.filter((item) => item.kind === kind);
      return {
        kind,
        byteSize: matches.reduce((total, item) => total + item.byteSize, 0),
        itemCount: matches.length,
      };
    });
    return {
      totalBytes: categories.reduce(
        (total, category) => total + category.byteSize,
        0,
      ),
      categories,
      items,
    };
  }

  private targetPath(item: StorageItemDto): string {
    if (item.kind === "asset") {
      const row = this.repository.findAsset(item.id);
      if (!row) throw new JobSubmissionError("Storage asset not found.", 404);
      const path = resolve(this.dataRoot, row.storagePath);
      if (!pathInside(this.dataRoot, path)) {
        throw new JobSubmissionError("Stored asset path is invalid.", 409);
      }
      return path;
    }
    if (item.kind === "output") {
      const row = this.repository.findOutput(item.id);
      if (!row) throw new JobSubmissionError("Stored output not found.", 404);
      const path = resolve(this.dataRoot, row.storagePath);
      if (!pathInside(this.dataRoot, path)) {
        throw new JobSubmissionError("Stored output path is invalid.", 409);
      }
      return path;
    }
    if (item.kind === "preview") {
      const path = resolve(this.previewRoot, `${item.id}.preview`);
      if (!pathInside(this.previewRoot, path)) {
        throw new JobSubmissionError("Stored preview path is invalid.", 409);
      }
      return path;
    }
    const row = this.repository.findModelDownloadRow(item.id);
    const path = row ? this.modelPath(row) : null;
    if (!row || !path) {
      throw new JobSubmissionError("Managed model download not found.", 404);
    }
    return path;
  }

  private async deleteItem(item: StorageItemDto): Promise<void> {
    const source = this.targetPath(item);
    const size = await this.regularFileSize(source);
    if (size === null) {
      throw new JobSubmissionError(
        "Cleanup target is missing, not a regular file, or a symbolic link.",
        409,
      );
    }
    const trashRoot = resolve(this.dataRoot, ".trash", "cleanup");
    await mkdir(trashRoot, { recursive: true });
    const staged = resolve(trashRoot, `${crypto.randomUUID()}.pending`);
    if (!pathInside(trashRoot, staged)) {
      throw new JobSubmissionError("Cleanup staging path is invalid.", 500);
    }
    await rename(source, staged);
    try {
      if (item.kind === "asset") {
        if (!this.repository.deleteAssetRecord(item.id)) {
          throw new Error("Asset record disappeared during cleanup.");
        }
      } else if (item.kind === "output") {
        if (!this.repository.deleteOutputRecord(item.id)) {
          throw new Error("Output record disappeared during cleanup.");
        }
      } else if (item.kind === "model_download") {
        const row = this.repository.findModelDownloadRow(item.id);
        if (!row) throw new Error("Model download disappeared during cleanup.");
        const metadata = parseJson<Record<string, unknown>>(
          row.metadataJson,
          {},
        );
        this.repository.updateModelDownload(item.id, {
          storagePath: null,
          metadata: {
            ...metadata,
            deletedAt: new Date().toISOString(),
            deletedFilename: row.filename,
          },
        });
      }
    } catch (error) {
      await rename(staged, source).catch(() => undefined);
      throw error;
    }
    // The managed record has already been removed at this point. A failure to
    // unlink the staged file must not turn a completed deletion into an
    // ambiguous API failure; the bounded trash directory remains recoverable.
    await unlink(staged).catch(() => undefined);
  }

  async cleanup(raw: unknown): Promise<StorageCleanupResultDto> {
    const parsed = storageCleanupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JobSubmissionError(
        "Storage cleanup selection is invalid.",
        422,
        parsed.error.flatten(),
      );
    }
    const inventory = await this.inventory();
    const byKey = new Map(
      inventory.items.map((item) => [`${item.kind}:${item.id}`, item]),
    );
    const selected = parsed.data.targets.map((target) => {
      const item = byKey.get(`${target.kind}:${target.id}`);
      if (!item) {
        if (parsed.data.dryRun) {
          throw new JobSubmissionError(
            `Storage cleanup target not found: ${target.kind}:${target.id}`,
            404,
          );
        }
        return { target, item: null };
      }
      return { target, item };
    });
    const results: StorageCleanupResultDto["results"] = [];
    for (const selectedItem of selected) {
      let item = selectedItem.item;
      if (!parsed.data.dryRun) {
        item =
          (await this.inventory()).items.find(
            (candidate) =>
              candidate.kind === selectedItem.target.kind &&
              candidate.id === selectedItem.target.id,
          ) ?? null;
      }
      if (!item) {
        results.push({
          ...selectedItem.target,
          eligible: false,
          deleted: false,
          byteSize: 0,
          reason: "The cleanup target is no longer available.",
          dependencies: [],
        });
        continue;
      }
      let deleted = false;
      if (item.cleanupEligible && !parsed.data.dryRun) {
        try {
          await this.deleteItem(item);
          deleted = true;
        } catch (error) {
          results.push({
            kind: item.kind,
            id: item.id,
            eligible: false,
            deleted: false,
            byteSize: item.byteSize,
            reason:
              error instanceof Error
                ? error.message
                : "The cleanup target could not be deleted.",
            dependencies: item.dependencies,
          });
          continue;
        }
      }
      results.push({
        kind: item.kind,
        id: item.id,
        eligible: item.cleanupEligible,
        deleted,
        byteSize: item.byteSize,
        reason: item.cleanupReason,
        dependencies: item.dependencies,
      });
    }
    return {
      dryRun: parsed.data.dryRun,
      reclaimedBytes: results
        .filter((result) => result.deleted)
        .reduce((total, result) => total + result.byteSize, 0),
      results,
    };
  }
}
