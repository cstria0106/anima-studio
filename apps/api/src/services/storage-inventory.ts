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
import { INSTANT_REFERENCE_GENERATED_LORA_DIRECTORY } from "../comfy/instant-reference";
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

export class StorageInventoryService {
  private readonly dataRoot: string;
  private readonly modelRoots: string[];
  private readonly loraRoot: string;
  private readonly instantLoraRoot: string;

  constructor(
    private readonly repository: StudioRepository,
    options: { dataDir: string; modelRoots: string[]; loraRoot: string },
  ) {
    this.dataRoot = resolve(options.dataDir);
    this.modelRoots = options.modelRoots.map((root) => resolve(root));
    this.loraRoot = resolve(options.loraRoot);
    this.instantLoraRoot = resolve(
      this.loraRoot,
      INSTANT_REFERENCE_GENERATED_LORA_DIRECTORY,
    );
  }

  private async regularFileSize(path: string): Promise<number | null> {
    try {
      const stats = await lstat(path);
      return stats.isFile() && !stats.isSymbolicLink() ? stats.size : null;
    } catch {
      return null;
    }
  }

  private modelPath(row: { storagePath: string }): string | null {
    const candidate = resolve(row.storagePath);
    return this.modelRoots.some((root) => pathInside(root, candidate))
      ? candidate
      : null;
  }

  private async instantLoraItems(): Promise<StorageItemDto[]> {
    const rootStats = await lstat(this.instantLoraRoot).catch(() => null);
    if (
      !rootStats?.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !pathInside(this.loraRoot, this.instantLoraRoot)
    ) {
      return [];
    }

    const items: StorageItemDto[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (!pathInside(this.instantLoraRoot, path)) continue;
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await visit(path);
          continue;
        }
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !entry.name.toLowerCase().endsWith(".safetensors")
        ) {
          continue;
        }
        const stats = await lstat(path).catch(() => null);
        if (!stats?.isFile() || stats.isSymbolicLink()) continue;
        const id = relative(this.loraRoot, path).split(sep).join("/");
        items.push({
          kind: "instant_lora",
          id,
          name: id,
          byteSize: stats.size,
          createdAt: (stats.birthtimeMs > 0
            ? stats.birthtime
            : stats.mtime
          ).toISOString(),
          dependencies: [],
          cleanupEligible: true,
          cleanupReason: null,
        });
      }
    };
    await visit(this.instantLoraRoot);
    return items;
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
              ? "This reference image is used by a generation."
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
              ? "This result is used as an upscale source."
              : null,
        };
      });
    const modelItems: StorageItemDto[] = [];
    for (const row of this.repository.listManagedModelInstallations()) {
      const path = this.modelPath(row);
      const fileSize = path ? await this.regularFileSize(path) : null;
      const dependencies = this.repository.modelDependencies(row.filename);
      modelItems.push({
        kind: "model_download",
        id: row.id,
        name: row.filename,
        byteSize: fileSize ?? 0,
        createdAt: row.installedAt,
        dependencies,
        cleanupEligible: false,
        cleanupReason:
          "Remove managed models from the model library.",
      });
    }
    const instantLoraItems = await this.instantLoraItems();
    const items = [
      ...assetItems,
      ...outputItems,
      ...instantLoraItems,
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
    if (item.kind === "instant_lora") {
      const path = resolve(this.loraRoot, item.id);
      if (!pathInside(this.instantLoraRoot, path)) {
        throw new JobSubmissionError(
          "Instant LoRA path is invalid.",
          409,
        );
      }
      return path;
    }
    const row = this.repository.findManagedModelInstallation(item.id);
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
      } else if (item.kind === "instant_lora") {
        // Instant Reference writes these files directly and has no studio DB row.
      } else if (item.kind === "model_download") {
        throw new Error("Remove managed models from the model library.");
      }
    } catch (error) {
      await rename(staged, source).catch(() => undefined);
      throw error;
    }
    // The source is no longer visible at this point. A failure to unlink the
    // staged file must not turn a completed deletion into an ambiguous API
    // failure; the bounded trash directory remains recoverable.
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
