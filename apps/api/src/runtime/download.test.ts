import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VerifiedResumableFileDownloader } from "./download";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("verified resumable file download", () => {
  test("restarts a full-length corrupt partial instead of retrying it forever", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "anima-verified-download-"),
    );
    temporaryDirectories.push(directory);
    const expected = new TextEncoder().encode("correct bytes");
    const corrupt = new TextEncoder().encode("corrupt bytes");
    const filename = "model.blob";
    await writeFile(join(directory, `${filename}.part`), corrupt);
    let suppliedRange: string | null = "not-called";
    const downloader = new VerifiedResumableFileDownloader(
      (async (_input, init) => {
        suppliedRange = new Headers(init?.headers).get("range");
        return new Response(expected, { status: 200 });
      }) as typeof fetch,
    );

    const path = await downloader.download(
      {
        id: "model",
        downloadUrl: "https://example.test/model",
        filename,
        bytes: expected.byteLength,
        sha256: createHash("sha256").update(expected).digest("hex"),
      },
      directory,
    );

    expect(suppliedRange).toBeNull();
    expect(await readFile(path)).toEqual(Buffer.from(expected));
  });
});
