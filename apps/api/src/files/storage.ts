import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AssetDto } from "@anima/shared";
import type { AppConfig } from "../config";
import {
  assetToDto,
  type NewOutput,
  StudioRepository,
} from "../db/repository";
import type { AssetRow, OutputRow } from "../db/schema";
import type { ComfyClientLike, UploadedImage } from "../comfy/client";
import { inspectImage } from "./image-metadata";

export class FileValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "FileValidationError";
  }
}

function cleanFilename(value: string): string {
  const cleaned = basename(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return cleaned || "image";
}

function pathInside(root: string, candidate: string): boolean {
  const child = resolve(candidate);
  const base = resolve(root);
  const rel = relative(base, child);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export interface StoredFile {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface ValidatedAssetUpload {
  bytes: Uint8Array;
  metadata: NonNullable<ReturnType<typeof inspectImage>>;
  sha256: string;
}

export class FileStorage {
  private readonly root: string;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "dataDir"
      | "maxUploadBytes"
      | "maxImageDimension"
      | "maxImagePixels"
    >,
    private readonly repository: StudioRepository,
  ) {
    this.root = resolve(config.dataDir);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(resolve(this.root, "assets"), { recursive: true }),
      mkdir(resolve(this.root, "outputs"), { recursive: true }),
      mkdir(resolve(this.root, "previews"), { recursive: true }),
    ]);
  }

  private absolute(storagePath: string): string {
    const path = resolve(this.root, storagePath);
    if (!pathInside(this.root, path)) {
      throw new Error("Stored path escapes the configured data directory.");
    }
    return path;
  }

  async validateAsset(file: File): Promise<ValidatedAssetUpload> {
    if (file.size <= 0) {
      throw new FileValidationError("The uploaded file is empty.");
    }
    if (file.size > this.config.maxUploadBytes) {
      throw new FileValidationError(
        `Image exceeds the ${this.config.maxUploadBytes} byte upload limit.`,
        413,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = inspectImage(bytes);
    if (!metadata) {
      throw new FileValidationError(
        "Only valid PNG, JPEG, and WebP images are accepted.",
      );
    }
    if (
      metadata.width === null ||
      metadata.height === null ||
      metadata.width <= 0 ||
      metadata.height <= 0
    ) {
      throw new FileValidationError(
        "The image dimensions could not be determined.",
      );
    }
    if (
      metadata.width > this.config.maxImageDimension ||
      metadata.height > this.config.maxImageDimension
    ) {
      throw new FileValidationError(
        `Image dimensions may not exceed ${this.config.maxImageDimension} pixels per side.`,
        413,
      );
    }
    const pixels = metadata.width * metadata.height;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > this.config.maxImagePixels
    ) {
      throw new FileValidationError(
        `Image pixel count may not exceed ${this.config.maxImagePixels}.`,
        413,
      );
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { bytes, metadata, sha256 };
  }

  async storeAsset(file: File): Promise<AssetDto> {
    const { bytes, metadata, sha256 } = await this.validateAsset(file);
    const existing = this.repository.findAssetByHash(sha256);
    if (existing) {
      try {
        await stat(this.absolute(existing.storagePath));
      } catch {
        await mkdir(dirname(this.absolute(existing.storagePath)), {
          recursive: true,
        });
        await writeFile(this.absolute(existing.storagePath), bytes);
      }
      return assetToDto(existing);
    }

    const storagePath = `assets/${sha256.slice(0, 2)}/${sha256}.${metadata.extension}`;
    const target = this.absolute(storagePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" }).catch(async (error) => {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EEXIST") throw error;
    });

    const row = this.repository.createAsset({
      id: crypto.randomUUID(),
      sha256,
      originalName: cleanFilename(file.name),
      mimeType: metadata.mimeType,
      byteSize: bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      storagePath,
      createdAt: new Date().toISOString(),
    });
    return assetToDto(row);
  }

  async readAsset(row: AssetRow): Promise<StoredFile> {
    return {
      bytes: await readFile(this.absolute(row.storagePath)),
      mimeType: row.mimeType,
      filename: row.originalName,
    };
  }

  async readOutput(row: OutputRow): Promise<StoredFile> {
    return {
      bytes: await readFile(this.absolute(row.storagePath)),
      mimeType: row.mimeType,
      filename: row.filename,
    };
  }

  async uploadAssetToComfy(
    row: AssetRow,
    comfy: ComfyClientLike,
  ): Promise<UploadedImage> {
    const stored = await this.readAsset(row);
    const extension = row.storagePath.split(".").at(-1) || "png";
    const upload = await comfy.uploadImage({
      bytes: stored.bytes,
      mimeType: stored.mimeType,
      filename: `${row.sha256}.${extension}`,
      subfolder: "anima-studio",
    });
    this.repository.setAssetComfyFilename(row.id, upload.inputName);
    return upload;
  }

  async uploadOutputToComfy(
    row: OutputRow,
    comfy: ComfyClientLike,
  ): Promise<UploadedImage> {
    const stored = await this.readOutput(row);
    const extension = row.storagePath.split(".").at(-1) || "png";
    return comfy.uploadImage({
      bytes: stored.bytes,
      mimeType: stored.mimeType,
      filename: `${row.id}.${extension}`,
      subfolder: "anima-studio/upscale-sources",
    });
  }

  async storePreview(
    jobId: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<StoredFile> {
    const metadata = inspectImage(bytes);
    if (
      !metadata ||
      (metadata.mimeType !== "image/jpeg" &&
        metadata.mimeType !== "image/png")
    ) {
      throw new FileValidationError(
        "ComfyUI preview frame is not a valid JPEG or PNG image.",
      );
    }
    const target = this.absolute(`previews/${jobId}.preview`);
    const temporary = this.absolute(
      `previews/${jobId}.${crypto.randomUUID()}.tmp`,
    );
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
    return {
      bytes,
      mimeType: metadata.mimeType ?? mimeType,
      filename: `${jobId}.${metadata.extension}`,
    };
  }

  async readPreview(jobId: string): Promise<StoredFile> {
    const bytes = await readFile(
      this.absolute(`previews/${jobId}.preview`),
    );
    const metadata = inspectImage(bytes);
    if (!metadata) {
      throw new FileValidationError("Stored preview image is invalid.", 500);
    }
    return {
      bytes,
      mimeType: metadata.mimeType,
      filename: `${jobId}.${metadata.extension}`,
    };
  }

  async storeOutput(input: {
    jobId: string;
    kind: "base" | "upscale";
    nodeId: string;
    comfyFilename: string;
    comfySubfolder: string;
    comfyType: string;
    bytes: Uint8Array;
    contentType: string | null;
  }): Promise<OutputRow> {
    const metadata = inspectImage(input.bytes);
    const mimeType =
      metadata?.mimeType ??
      (input.contentType?.split(";")[0] || "application/octet-stream");
    const extension =
      metadata?.extension ??
      input.comfyFilename.split(".").at(-1)?.toLowerCase() ??
      "bin";
    const id = crypto.randomUUID();
    const storagePath = `outputs/${input.jobId}/${id}.${extension}`;
    const target = this.absolute(storagePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx" });

    const output: NewOutput = {
      id,
      jobId: input.jobId,
      kind: input.kind,
      nodeId: input.nodeId,
      filename: cleanFilename(input.comfyFilename),
      mimeType,
      byteSize: input.bytes.byteLength,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      storagePath,
      comfyFilename: input.comfyFilename,
      comfySubfolder: input.comfySubfolder,
      comfyType: input.comfyType,
      createdAt: new Date().toISOString(),
    };
    return this.repository.createOutput(output);
  }
}
