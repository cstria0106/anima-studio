import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  rename,
  stat,
} from "node:fs/promises";
import { basename, join } from "node:path";

import type { EngineArtifact } from "@anima/runtime";

export interface DownloadProgress {
  artifactId: string;
  currentBytes: number;
  totalBytes: number;
}

export interface ArtifactDownloader {
  download(
    artifact: EngineArtifact,
    directory: string,
    options?: {
      signal?: AbortSignal;
      onProgress?(progress: DownloadProgress): void;
    },
  ): Promise<string>;
}

export interface VerifiedFileDownload {
  id: string;
  downloadUrl: string;
  filename: string;
  bytes: number;
  sha256: string;
  headers?: Readonly<Record<string, string>>;
}

export interface VerifiedFileDownloader {
  download(
    file: VerifiedFileDownload,
    directory: string,
    options?: {
      signal?: AbortSignal;
      onProgress?(progress: DownloadProgress): void;
    },
  ): Promise<string>;
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

export class FileDownloadHttpError extends Error {
  constructor(
    readonly artifactId: string,
    readonly status: number,
  ) {
    super(`Could not download ${artifactId}: HTTP ${status}.`);
    this.name = "FileDownloadHttpError";
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function matchesArtifact(
  path: string,
  artifact: Pick<VerifiedFileDownload, "bytes" | "sha256">,
): Promise<boolean> {
  try {
    const metadata = await stat(path);
    return (
      metadata.isFile() &&
      metadata.size === artifact.bytes &&
      (await sha256File(path)) === artifact.sha256
    );
  } catch {
    return false;
  }
}

function contentRangeStart(value: string | null): number | null {
  const match = value?.match(/^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i);
  return match ? Number(match[1]) : null;
}

export class VerifiedResumableFileDownloader
  implements VerifiedFileDownloader
{
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async download(
    artifact: VerifiedFileDownload,
    directory: string,
    options: {
      signal?: AbortSignal;
      onProgress?(progress: DownloadProgress): void;
    } = {},
  ): Promise<string> {
    await mkdir(directory, { recursive: true });
    const finalPath = join(directory, artifact.filename);
    const partialPath = `${finalPath}.part`;

    if (await matchesArtifact(finalPath, artifact)) {
      options.onProgress?.({
        artifactId: artifact.id,
        currentBytes: artifact.bytes,
        totalBytes: artifact.bytes,
      });
      return finalPath;
    }
    try {
      const existingFinal = await stat(finalPath);
      if (existingFinal.isFile()) {
        await rename(
          finalPath,
          `${finalPath}.corrupt-${crypto.randomUUID()}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        !("code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }

    let offset = 0;
    try {
      offset = (await stat(partialPath)).size;
    } catch {
      // A new partial file starts at zero bytes.
    }
    if (offset === artifact.bytes) {
      if (await matchesArtifact(partialPath, artifact)) {
        await rename(partialPath, finalPath);
        options.onProgress?.({
          artifactId: artifact.id,
          currentBytes: artifact.bytes,
          totalBytes: artifact.bytes,
        });
        return finalPath;
      }
      await rename(
        partialPath,
        `${partialPath}.corrupt-${crypto.randomUUID()}`,
      );
      offset = 0;
    } else if (offset > artifact.bytes) {
      await rename(
        partialPath,
        `${partialPath}.corrupt-${crypto.randomUUID()}`,
      );
      offset = 0;
    }

    const headers = new Headers(artifact.headers);
    if (offset > 0) headers.set("range", `bytes=${offset}-`);
    const request: RequestInit = {
      headers,
      redirect: "follow",
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const response = await this.fetcher(artifact.downloadUrl, request);

    if (response.status === 416 && offset === artifact.bytes) {
      if (!(await matchesArtifact(partialPath, artifact))) {
        throw new ArtifactIntegrityError(
          `${artifact.id} partial download failed integrity verification.`,
        );
      }
      await rename(partialPath, finalPath);
      return finalPath;
    }
    if (!response.ok || !response.body) {
      throw new FileDownloadHttpError(artifact.id, response.status);
    }

    let append = offset > 0 && response.status === 206;
    if (append) {
      const rangeStart = contentRangeStart(response.headers.get("content-range"));
      if (rangeStart !== offset) {
        throw new Error(
          `${artifact.id} returned an invalid Content-Range for resume.`,
        );
      }
    } else {
      offset = 0;
      append = false;
    }

    const file = await open(partialPath, append ? "a" : "w");
    let currentBytes = offset;
    try {
      const reader = response.body.getReader();
      while (true) {
        options.signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        await file.write(chunk.value);
        currentBytes += chunk.value.byteLength;
        if (currentBytes > artifact.bytes) {
          throw new ArtifactIntegrityError(
            `${artifact.id} exceeded its pinned byte length.`,
          );
        }
        options.onProgress?.({
          artifactId: artifact.id,
          currentBytes,
          totalBytes: artifact.bytes,
        });
      }
      await file.sync();
    } finally {
      await file.close();
    }

    const actualSize = (await stat(partialPath)).size;
    if (actualSize !== artifact.bytes) {
      throw new ArtifactIntegrityError(
        `${artifact.id} expected ${artifact.bytes} bytes but received ${actualSize}.`,
      );
    }
    const actualHash = await sha256File(partialPath);
    if (actualHash !== artifact.sha256) {
      throw new ArtifactIntegrityError(
        `${artifact.id} SHA-256 mismatch (expected ${artifact.sha256}, received ${actualHash}).`,
      );
    }
    try {
      await rename(partialPath, finalPath);
    } catch (error) {
      throw new Error(
        `Could not activate verified download ${basename(finalPath)}.`,
        { cause: error },
      );
    }
    return finalPath;
  }
}

export class ResumableArtifactDownloader implements ArtifactDownloader {
  private readonly files: VerifiedResumableFileDownloader;

  constructor(fetcher: typeof fetch = fetch) {
    this.files = new VerifiedResumableFileDownloader(fetcher);
  }

  download(
    artifact: EngineArtifact,
    directory: string,
    options: {
      signal?: AbortSignal;
      onProgress?(progress: DownloadProgress): void;
    } = {},
  ): Promise<string> {
    return this.files.download(
      {
        id: artifact.id,
        downloadUrl: artifact.downloadUrl,
        filename: `${artifact.id}-${artifact.sha256.slice(0, 16)}.${artifact.archive.format}`,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      },
      directory,
      options,
    );
  }
}
