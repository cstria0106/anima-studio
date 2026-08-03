import type {
  LibraryFolderDto,
  LibraryImageDeleteResultDto,
  LibraryImageDto,
  LibraryImageListDto,
} from "@anima/shared";
import { StudioRepository } from "../db/repository";
import type { FolderRow } from "../db/schema";
import { FileStorage } from "../files/storage";
import { JobSubmissionError } from "./jobs";

const MAX_BATCH_SIZE = 500;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JobSubmissionError("Request body must be an object.", 400);
  }
  return value as Record<string, unknown>;
}

function folderName(value: unknown): string {
  if (typeof value !== "string") {
    throw new JobSubmissionError("Folder name must be a string.", 422);
  }
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) {
    throw new JobSubmissionError(
      "Folder name must contain between 1 and 80 characters.",
      422,
    );
  }
  return name;
}

function nullableId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 240) {
    throw new JobSubmissionError(`${field} must be a valid id or null.`, 422);
  }
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_SIZE) {
    throw new JobSubmissionError(
      `ids must contain between 1 and ${MAX_BATCH_SIZE} items.`,
      422,
    );
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || !item || item.length > 240) {
      throw new JobSubmissionError("Every image id must be valid.", 422);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new JobSubmissionError("Image ids must be unique.", 422);
  }
  return result;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string | undefined): {
  createdAt: string;
  id: string;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.createdAt ||
      !parsed.id
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new JobSubmissionError("Library cursor is invalid.", 400);
  }
}

function imageDto(row: ReturnType<StudioRepository["listLibraryImages"]>[number]): LibraryImageDto {
  return {
    id: row.id,
    jobId: row.jobId,
    folderId: row.folderId,
    kind: row.kind === "upscale" ? "upscale" : "base",
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    url: `/api/outputs/${encodeURIComponent(row.id)}`,
    createdAt: row.createdAt.includes("T")
      ? row.createdAt
      : `${row.createdAt.replace(" ", "T")}Z`,
  };
}

export class LibraryService {
  constructor(
    private readonly repository: StudioRepository,
    private readonly storage: FileStorage,
  ) {}

  folders(): LibraryFolderDto[] {
    const rows = this.repository.listFolders();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const direct = new Map(rows.map((row) => [row.id, 0]));
    for (const output of this.repository.listOutputRows()) {
      if (output.folderId && direct.has(output.folderId)) {
        direct.set(output.folderId, (direct.get(output.folderId) ?? 0) + 1);
      }
    }
    const total = new Map(direct);
    for (const row of rows) {
      const amount = direct.get(row.id) ?? 0;
      let parentId = row.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        total.set(parentId, (total.get(parentId) ?? 0) + amount);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      directImageCount: direct.get(row.id) ?? 0,
      totalImageCount: total.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private assertParent(parentId: string | null): FolderRow | null {
    if (!parentId) return null;
    const parent = this.repository.findFolder(parentId);
    if (!parent) throw new JobSubmissionError("Parent folder not found.", 404);
    return parent;
  }

  private assertUniqueName(
    name: string,
    parentId: string | null,
    exceptId?: string,
  ): void {
    const duplicate = this.repository
      .listFolders()
      .some(
        (row) =>
          row.id !== exceptId &&
          row.parentId === parentId &&
          sameName(row.name, name),
      );
    if (duplicate) {
      throw new JobSubmissionError(
        "A folder with this name already exists at this level.",
        409,
      );
    }
  }

  createFolder(raw: unknown): LibraryFolderDto {
    const input = object(raw);
    const name = folderName(input.name);
    const parentId = nullableId(input.parentId, "parentId");
    this.assertParent(parentId);
    this.assertUniqueName(name, parentId);
    const row = this.repository.createFolder({
      id: crypto.randomUUID(),
      name,
      parentId,
      createdAt: new Date().toISOString(),
    });
    return {
      ...row,
      directImageCount: 0,
      totalImageCount: 0,
    };
  }

  updateFolder(id: string, raw: unknown): LibraryFolderDto {
    const current = this.repository.findFolder(id);
    if (!current) throw new JobSubmissionError("Folder not found.", 404);
    const input = object(raw);
    if (!("name" in input) && !("parentId" in input)) {
      throw new JobSubmissionError("Folder update is empty.", 422);
    }
    const name = "name" in input ? folderName(input.name) : current.name;
    const parentId =
      "parentId" in input
        ? nullableId(input.parentId, "parentId")
        : current.parentId;
    if (parentId === id) {
      throw new JobSubmissionError("A folder cannot contain itself.", 409);
    }
    this.assertParent(parentId);
    const byId = new Map(this.repository.listFolders().map((row) => [row.id, row]));
    let ancestorId = parentId;
    const visited = new Set<string>();
    while (ancestorId) {
      if (ancestorId === id) {
        throw new JobSubmissionError(
          "A folder cannot be moved into one of its descendants.",
          409,
        );
      }
      if (visited.has(ancestorId)) {
        throw new JobSubmissionError("Folder hierarchy contains a cycle.", 409);
      }
      visited.add(ancestorId);
      ancestorId = byId.get(ancestorId)?.parentId ?? null;
    }
    this.assertUniqueName(name, parentId, id);
    this.repository.updateFolder(id, { name, parentId });
    return this.folders().find((folder) => folder.id === id)!;
  }

  deleteFolder(id: string): { deletedFolderCount: number; unfiledImageCount: number } {
    if (!this.repository.findFolder(id)) {
      throw new JobSubmissionError("Folder not found.", 404);
    }
    const rows = this.repository.listFolders();
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const group = children.get(row.parentId) ?? [];
      group.push(row.id);
      children.set(row.parentId, group);
    }
    const subtree: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      subtree.push(next);
      stack.push(...(children.get(next) ?? []));
    }
    const subtreeSet = new Set(subtree);
    const unfiledImageCount = this.repository
      .listOutputRows()
      .filter((output) => output.folderId && subtreeSet.has(output.folderId)).length;
    this.repository.deleteFolderTree(subtree.reverse());
    return { deletedFolderCount: subtree.length, unfiledImageCount };
  }

  images(query: {
    folder?: string;
    query?: string;
    cursor?: string;
    limit?: number;
  }): LibraryImageListDto {
    const folder = query.folder ?? "all";
    const cursor = decodeCursor(query.cursor);
    let folderId: string | null | undefined;
    let allFolders = false;
    if (folder === "all") allFolders = true;
    else if (folder === "unfiled") folderId = null;
    else {
      if (!this.repository.findFolder(folder)) {
        throw new JobSubmissionError("Folder not found.", 404);
      }
      folderId = folder;
    }
    const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);
    const rows = this.repository.listLibraryImages({
      allFolders,
      ...(folderId !== undefined ? { folderId } : {}),
      ...(query.query?.trim() ? { query: query.query.trim() } : {}),
      ...(cursor
        ? { beforeCreatedAt: cursor.createdAt, beforeId: cursor.id }
        : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    return {
      images: page.map(imageDto),
      nextCursor:
        rows.length > limit && page.length > 0
          ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id)
          : null,
    };
  }

  moveImages(raw: unknown): { moved: number } {
    const input = object(raw);
    const outputIds = ids(input.ids);
    const targetFolderId = nullableId(input.folderId, "folderId");
    this.assertParent(targetFolderId);
    const found = outputIds.filter((id) => this.repository.findOutput(id));
    if (found.length !== outputIds.length) {
      throw new JobSubmissionError("One or more images no longer exist.", 404);
    }
    return { moved: this.repository.moveOutputs(outputIds, targetFolderId) };
  }

  downloadImages(outputIds: string[]): Array<{
    filename: string;
    mimeType: string;
    load: () => Promise<Uint8Array>;
  }> {
    const validatedIds = ids(outputIds);
    return validatedIds.map((id) => {
      const output = this.repository.findOutput(id);
      if (!output) {
        throw new JobSubmissionError("One or more images no longer exist.", 404);
      }
      return {
        filename: output.filename,
        mimeType: output.mimeType,
        load: async () => (await this.storage.readOutput(output)).bytes,
      };
    });
  }

  async deleteImages(raw: unknown): Promise<LibraryImageDeleteResultDto> {
    const input = object(raw);
    const outputIds = ids(input.ids);
    const result: LibraryImageDeleteResultDto = { deletedIds: [], blocked: [] };
    for (const id of outputIds) {
      const output = this.repository.findOutput(id);
      if (!output) {
        result.blocked.push({ id, reason: "이미지를 찾을 수 없습니다." });
        continue;
      }
      if (
        this.repository
          .sourceOutputJobs(id)
          .some((job) => job.status === "uploading")
      ) {
        result.blocked.push({
          id,
          reason: "업스케일 입력을 업로드하는 동안에는 삭제할 수 없습니다.",
        });
        continue;
      }
      try {
        if (await this.storage.deleteOutputData(output)) {
          result.deletedIds.push(id);
          const job = this.repository.findJobRow(output.jobId);
          if (
            job &&
            ["completed", "failed", "cancelled"].includes(job.status) &&
            this.repository.listOutputs(output.jobId).length === 0
          ) {
            await this.storage.deleteJobData(output.jobId).catch(() => false);
          }
        } else {
          result.blocked.push({ id, reason: "이미지가 이미 삭제되었습니다." });
        }
      } catch (error) {
        result.blocked.push({
          id,
          reason:
            error instanceof Error
              ? error.message
              : "이미지를 삭제하지 못했습니다.",
        });
      }
    }
    return result;
  }

  async pruneEmptyTerminalJobs(): Promise<void> {
    for (const job of this.repository.listEmptyTerminalJobs()) {
      await this.storage.deleteJobData(job.id).catch(() => undefined);
    }
  }
}
