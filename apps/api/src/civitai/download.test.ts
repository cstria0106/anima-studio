import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  VerifiedFileDownload,
  VerifiedFileDownloader,
} from "../runtime";
import {
  DirectCivitaiDownloadClient,
  type CivitaiDownloadInput,
} from "./download";
import { CIVITAI_TOKEN_SECRET } from "./secrets";
import type { SecretStore } from "./types";

const directories: string[] = [];
const sha256 = "a".repeat(64);

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();

  constructor(token: string | null = "test-token") {
    if (token) this.values.set(CIVITAI_TOKEN_SECRET, token);
  }

  read(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  write(key: string, secret: string): Promise<void> {
    this.values.set(key, secret);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.values.has(key));
  }
}

async function input(): Promise<CivitaiDownloadInput> {
  const directory = await mkdtemp(join(tmpdir(), "anima-civitai-download-"));
  directories.push(directory);
  return {
    downloadId: crypto.randomUUID(),
    modelId: 123,
    versionId: 456,
    modelKind: "lora",
    file: {
      id: 10,
      name: "style.safetensors",
      sizeBytes: 100,
      remoteType: "Model",
      format: "SafeTensor",
      precision: "fp16",
      sizeVariant: "full",
      primary: true,
      sha256,
      downloadUrl: "https://civitai.com/api/download/models/456",
      eligible: true,
      blockReason: null,
    },
    destination: {
      rootId: "loras",
      kind: "loras",
      absoluteRoot: directory,
      absoluteDirectory: directory,
      relativeDirectory: "",
    },
  };
}

describe("direct Civitai downloader", () => {
  test("rejects before starting a transfer when the API key is missing", async () => {
    const secrets = new MemorySecrets(null);
    let transfers = 0;
    const files: VerifiedFileDownloader = {
      async download() {
        transfers += 1;
        throw new Error("download should not start");
      },
    };
    const client = new DirectCivitaiDownloadClient(secrets, files);

    await expect(client.download(await input())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(transfers).toBe(0);
  });

  test("passes the token only as an authorization header and reports progress", async () => {
    const secrets = new MemorySecrets();
    secrets.values.set(CIVITAI_TOKEN_SECRET, "private-token");
    let received: VerifiedFileDownload | null = null;
    const files: VerifiedFileDownloader = {
      async download(file, directory, options) {
        received = file;
        options?.onProgress?.({
          artifactId: file.id,
          currentBytes: 50,
          totalBytes: 100,
        });
        return join(directory, file.filename);
      },
    };
    const request = await input();
    const observedProgress: number[] = [];
    request.onProgress = (progress) => {
      observedProgress.push(progress.percent);
    };
    let currentTime = 0;
    const client = new DirectCivitaiDownloadClient(
      secrets,
      files,
      CIVITAI_TOKEN_SECRET,
      () => (currentTime += 300),
    );

    const result = await client.download(request);

    expect(received).toMatchObject({
      downloadUrl: request.file.downloadUrl,
      filename: request.file.name,
      bytes: request.file.sizeBytes,
      sha256,
      headers: { authorization: "Bearer private-token" },
    });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(observedProgress).toContain(50);
    expect(result).toEqual({
      downloadId: request.downloadId,
      finalPath: join(
        request.destination.absoluteDirectory,
        request.file.name,
      ),
      expectedSha256: sha256,
      actualSha256: sha256,
    });
  });

  test("resumes a transfer even when resume races the pause abort", async () => {
    const secrets = new MemorySecrets();
    let calls = 0;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const files: VerifiedFileDownloader = {
      async download(file, directory, options) {
        calls += 1;
        if (calls === 1) {
          started();
          return new Promise<string>((_, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          });
        }
        return join(directory, file.filename);
      },
    };
    const request = await input();
    const client = new DirectCivitaiDownloadClient(secrets, files);
    const completion = client.download(request);
    await firstStarted;

    await client.pause(request.downloadId);
    expect(await client.getProgress(request.downloadId)).toMatchObject({
      state: "paused",
    });
    await client.resume(request.downloadId);

    await expect(completion).resolves.toMatchObject({
      downloadId: request.downloadId,
    });
    expect(calls).toBe(2);
  });

  test("cancellation rejects the transfer and removes its partial file", async () => {
    const secrets = new MemorySecrets();
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const files: VerifiedFileDownloader = {
      async download(file, directory, options) {
        await Bun.write(`${join(directory, file.filename)}.part`, "partial");
        started();
        return new Promise<string>((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    };
    const request = await input();
    const partial = `${join(
      request.destination.absoluteDirectory,
      request.file.name,
    )}.part`;
    const client = new DirectCivitaiDownloadClient(secrets, files);
    const completion = client.download(request);
    await firstStarted;

    await client.cancel(request.downloadId);

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    await expect(stat(partial)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("an external shutdown abort preserves the partial file for retry", async () => {
    const secrets = new MemorySecrets();
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const files: VerifiedFileDownloader = {
      async download(file, directory, options) {
        await Bun.write(`${join(directory, file.filename)}.part`, "partial");
        started();
        return new Promise<string>((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    };
    const controller = new AbortController();
    const request = { ...(await input()), signal: controller.signal };
    const partial = `${join(
      request.destination.absoluteDirectory,
      request.file.name,
    )}.part`;
    const client = new DirectCivitaiDownloadClient(secrets, files);
    const completion = client.download(request);
    await firstStarted;

    controller.abort(new Error("API shutting down"));

    await expect(completion).rejects.toThrow("API shutting down");
    expect((await stat(partial)).isFile()).toBeTrue();
  });
});
