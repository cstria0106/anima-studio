import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { CivitaiError, assertCivitai } from "./errors";
import { normalizeSha256 } from "./parser";

export interface FileHasher {
  sha256(filePath: string): Promise<string>;
}

export class NodeFileHasher implements FileHasher {
  async sha256(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk as Uint8Array);
      }
    } catch {
      throw new CivitaiError(
        "DOWNLOAD_FAILED",
        "The downloaded model file could not be verified.",
        500,
      );
    }
    return hash.digest("hex");
  }
}

export function sha256Matches(
  expected: string,
  actual: string,
): boolean {
  const left = normalizeSha256(expected);
  const right = normalizeSha256(actual);
  if (!left || !right) return false;
  return timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

export interface InvalidDownloadHandler {
  reject(filePath: string, downloadId: string): Promise<void>;
}

/**
 * Use only for files created by the current managed download. This removes a
 * file that failed its independent integrity check from the model library.
 */
export class RemoveInvalidDownloadHandler
  implements InvalidDownloadHandler
{
  async reject(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      throw new CivitaiError(
        "HASH_MISMATCH",
        "The invalid model file could not be removed.",
        500,
      );
    }
  }
}

/**
 * Moves invalid files to an app-owned quarantine instead of deleting them.
 * The quarantine root is configured by the server and never by an API caller.
 */
export class QuarantineInvalidDownloadHandler
  implements InvalidDownloadHandler
{
  private readonly root: string;

  constructor(root: string) {
    assertCivitai(
      isAbsolute(root),
      "INVALID_DESTINATION",
      "The quarantine directory must use an absolute path.",
      500,
    );
    this.root = resolve(root);
    assertCivitai(
      resolve(this.root, "..") !== this.root,
      "INVALID_DESTINATION",
      "The quarantine directory cannot be a filesystem root.",
      500,
    );
  }

  async reject(filePath: string, downloadId: string): Promise<void> {
    const safeId = downloadId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
    const destination = join(
      this.root,
      `${safeId}-${Date.now()}-${basename(filePath)}`,
    );
    try {
      await mkdir(dirname(destination), { recursive: true });
      await rename(filePath, destination);
    } catch {
      throw new CivitaiError(
        "HASH_MISMATCH",
        "The invalid model file could not be quarantined.",
        500,
      );
    }
  }
}
