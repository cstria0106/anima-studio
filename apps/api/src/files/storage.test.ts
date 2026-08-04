import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioRepository } from "../db/repository";
import type { AssetRow, OutputRow } from "../db/schema";
import { FileStorage } from "./storage";

test("preserves an output as a deduplicated asset snapshot", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "anima-inpaint-source-"));
  try {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    const outputPath = "outputs/source-job/source.png";
    await mkdir(join(dataDir, "outputs", "source-job"), { recursive: true });
    await writeFile(join(dataDir, outputPath), bytes);

    const assets = new Map<string, AssetRow>();
    let createCount = 0;
    const repository = {
      findAssetByHash(sha256: string) {
        return [...assets.values()].find((asset) => asset.sha256 === sha256) ?? null;
      },
      createAsset(input: Omit<AssetRow, "comfyFilename">) {
        createCount += 1;
        const row = { ...input, comfyFilename: null };
        assets.set(row.id, row);
        return row;
      },
    } as unknown as StudioRepository;
    const storage = new FileStorage(
      {
        dataDir,
        maxUploadBytes: 1024,
        maxImageDimension: 1024,
        maxImagePixels: 1024 * 1024,
      },
      repository,
    );
    const output: OutputRow = {
      id: "source-output",
      jobId: "source-job",
      kind: "base",
      nodeId: "24",
      filename: "source.png",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
      width: 1,
      height: 1,
      storagePath: outputPath,
      comfyFilename: "source.png",
      comfySubfolder: "",
      comfyType: "output",
      folderId: null,
      createdAt: "2026-08-04T00:00:00.000Z",
    };

    const first = await storage.preserveOutputAsAsset(output);
    const second = await storage.preserveOutputAsAsset(output);
    await unlink(join(dataDir, outputPath));

    expect(second.id).toBe(first.id);
    expect(createCount).toBe(1);
    expect((await storage.readAsset(first)).bytes).toEqual(bytes);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
