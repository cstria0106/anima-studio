import { describe, expect, test } from "bun:test";
import { generationConfigSchema } from "@anima/shared";
import { loadConfig } from "../config";
import { createDatabase } from "./database";
import { StudioRepository } from "./repository";

describe("inpaint persistence", () => {
  test("keeps source and mask separate from references and protects their dependencies", () => {
    const database = createDatabase(
      loadConfig({ databasePath: ":memory:", dataDir: "C:\\anima-test-data" }),
    );
    const repository = new StudioRepository(database);
    const createdAt = "2026-08-04T00:00:00.000Z";
    const addAsset = (id: string, hashCharacter: string) =>
      repository.createAsset({
        id,
        sha256: hashCharacter.repeat(64),
        originalName: `${id}.png`,
        mimeType: "image/png",
        byteSize: 10,
        width: 512,
        height: 512,
        storagePath: `assets/${id}.png`,
        createdAt,
      });
    const rootSource = addAsset("root-source", "a");
    const inputSource = addAsset("input-source", "b");
    const mask = addAsset("mask", "c");
    const reference = addAsset("reference", "d");
    const config = generationConfigSchema.parse({
      referenceAssetIds: [reference.id],
      model: {
        diffusionModel: "diffusion.safetensors",
        clip: "clip.safetensors",
        vae: "vae.safetensors",
      },
      image: { width: 512, height: 512 },
    });

    repository.createJob({
      id: "inpaint-job",
      kind: "inpaint",
      clientId: "test-client",
      config,
      actualSeed: 42,
      assetIds: [reference.id],
      inpaint: {
        inputSourceAssetId: inputSource.id,
        rootSourceAssetId: rootSource.id,
        maskAssetId: mask.id,
        growMaskBy: 6,
      },
      createdAt,
    });

    expect(repository.findJob("inpaint-job")).toMatchObject({
      kind: "inpaint",
      assets: [{ id: reference.id }],
      inpaint: {
        inputSourceAsset: { id: inputSource.id },
        rootSourceAsset: { id: rootSource.id },
        maskAsset: { id: mask.id },
        growMaskBy: 6,
      },
    });
    expect(repository.assetDependencies(inputSource.id)).toEqual([
      expect.objectContaining({ id: "inpaint-job" }),
    ]);
    expect(repository.assetDependencies(rootSource.id)).toEqual([
      expect.objectContaining({ id: "inpaint-job" }),
    ]);
    expect(repository.assetDependencies(mask.id)).toEqual([
      expect.objectContaining({ id: "inpaint-job" }),
    ]);
    expect(() => repository.deleteAssetRecord(mask.id)).toThrow();

    expect(repository.deleteJobRecord("inpaint-job")).toBeTrue();
    expect(repository.findJobInpaint("inpaint-job")).toBeNull();
    expect(repository.deleteAssetRecord(mask.id)).toBeTrue();
    database.close();
  });
});
