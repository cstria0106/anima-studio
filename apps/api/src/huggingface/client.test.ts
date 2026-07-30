import { describe, expect, test } from "bun:test";

import {
  HUGGING_FACE_ANIMA_REPOSITORY,
  HuggingFaceAnimaClient,
  type HuggingFaceJsonTransport,
} from "./client";

const revision = "f".repeat(40);
const diffusionHash = "a".repeat(64);
const encoderHash = "b".repeat(64);
const vaeHash = "c".repeat(64);

function entry(path: string, size: number, sha256: string) {
  return {
    type: "file",
    oid: "d".repeat(40),
    size,
    path,
    lfs: { oid: sha256, size, pointerSize: 128 },
  };
}

class FixtureTransport implements HuggingFaceJsonTransport {
  readonly urls: string[] = [];

  constructor(private readonly mismatch = false) {}

  json(url: string): Promise<unknown> {
    this.urls.push(url);
    if (url.includes("/tree/")) {
      return Promise.resolve([
        {
          type: "directory",
          oid: "0".repeat(40),
          size: 0,
          path: "split_files",
        },
        entry(
          "split_files/diffusion_models/anima-base-v1.0.safetensors",
          12,
          diffusionHash,
        ),
        entry(
          "split_files/text_encoders/qwen_3_06b_base.safetensors",
          8,
          encoderHash,
        ),
        {
          ...entry(
            "split_files/vae/qwen_image_vae.safetensors",
            4,
            vaeHash,
          ),
          ...(this.mismatch ? { size: 5 } : {}),
        },
        entry("../escape.safetensors", 2, "e".repeat(64)),
        {
          type: "file",
          oid: "1".repeat(40),
          size: 2,
          path: "split_files/diffusion_models/unsafe.ckpt",
        },
      ]);
    }
    return Promise.resolve({
      id: HUGGING_FACE_ANIMA_REPOSITORY,
      sha: revision,
      private: false,
      gated: false,
      lastModified: "2026-07-24T19:59:32Z",
    });
  }
}

describe("Hugging Face Anima catalog", () => {
  test("pins the official repository revision and exposes only verified model roots", async () => {
    const transport = new FixtureTransport();
    const client = new HuggingFaceAnimaClient(transport);

    const catalog = await client.catalog();

    expect(catalog.repository).toBe(HUGGING_FACE_ANIMA_REPOSITORY);
    expect(catalog.revision).toBe(revision);
    expect(catalog.files.map((file) => file.destinationRootId)).toEqual([
      "diffusion_models",
      "text_encoders",
      "vae",
    ]);
    expect(catalog.files.map((file) => file.sha256)).toEqual([
      diffusionHash,
      encoderHash,
      vaeHash,
    ]);
    expect(transport.urls[1]).toContain(`/tree/${revision}`);
    expect(
      client.downloadUrl(revision, catalog.files[0]!.path),
    ).toBe(
      `https://huggingface.co/${HUGGING_FACE_ANIMA_REPOSITORY}/resolve/${revision}/split_files/diffusion_models/anima-base-v1.0.safetensors?download=true`,
    );
  });

  test("rejects an LFS size mismatch instead of trusting repository metadata", async () => {
    const client = new HuggingFaceAnimaClient(
      new FixtureTransport(true),
    );

    await expect(client.catalog()).rejects.toMatchObject({
      code: "CATALOG_INCOMPATIBLE",
    });
  });
});
