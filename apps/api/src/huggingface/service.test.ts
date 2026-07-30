import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  HuggingFaceAnimaCatalogDto,
  HuggingFaceAnimaFileDto,
} from "@anima/shared";

import { DestinationRegistry } from "../civitai";
import { createDatabase } from "../db/database";
import { StudioRepository } from "../db/repository";
import {
  type VerifiedFileDownload,
  type VerifiedFileDownloader,
  VerifiedResumableFileDownloader,
} from "../runtime/download";
import { OperationService } from "../services/operations";
import {
  HUGGING_FACE_ANIMA_REPOSITORY,
  HuggingFaceAnimaClient,
} from "./client";
import { HuggingFaceAnimaLibraryService } from "./service";

const temporaryDirectories: string[] = [];
const databases: ReturnType<typeof createDatabase>[] = [];
const revision = "f".repeat(40);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function modelFile(
  path: string,
  kind: HuggingFaceAnimaFileDto["kind"],
  destinationRootId: HuggingFaceAnimaFileDto["destinationRootId"],
  bytes: Uint8Array,
): HuggingFaceAnimaFileDto {
  return {
    path,
    filename: path.split("/").at(-1)!,
    kind,
    destinationRootId,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    recommended: true,
    experimental: false,
  };
}

class CatalogClient extends HuggingFaceAnimaClient {
  constructor(private readonly fixture: HuggingFaceAnimaCatalogDto) {
    super({ json: () => Promise.reject(new Error("not used")) });
  }

  override catalog(requested?: string) {
    if (requested && requested !== this.fixture.revision) {
      return Promise.reject(new Error("revision mismatch"));
    }
    return Promise.resolve(this.fixture);
  }
}

class FixtureDownloader implements VerifiedFileDownloader {
  readonly order: string[] = [];

  constructor(private readonly bytes: Map<string, Uint8Array>) {}

  async download(
    file: VerifiedFileDownload,
    directory: string,
    options: Parameters<VerifiedFileDownloader["download"]>[2] = {},
  ): Promise<string> {
    const value = this.bytes.get(file.sha256)!;
    await mkdir(directory, { recursive: true });
    const path = join(directory, file.filename);
    await writeFile(path, value);
    this.order.push(file.id);
    options?.onProgress?.({
      artifactId: file.id,
      currentBytes: value.byteLength,
      totalBytes: value.byteLength,
    });
    return path;
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "anima-hf-test-"));
  temporaryDirectories.push(root);
  const modelBytes = new TextEncoder().encode("model");
  const encoderBytes = new TextEncoder().encode("encoder");
  const vaeBytes = new TextEncoder().encode("vae");
  const files = [
    modelFile(
      "split_files/diffusion_models/anima-base-v1.0.safetensors",
      "diffusion_model",
      "diffusion_models",
      modelBytes,
    ),
    modelFile(
      "split_files/text_encoders/qwen_3_06b_base.safetensors",
      "text_encoder",
      "text_encoders",
      encoderBytes,
    ),
    modelFile(
      "split_files/vae/qwen_image_vae.safetensors",
      "vae",
      "vae",
      vaeBytes,
    ),
  ];
  const catalog: HuggingFaceAnimaCatalogDto = {
    provider: "huggingface",
    repository: HUGGING_FACE_ANIMA_REPOSITORY,
    sourceUrl: `https://huggingface.co/${HUGGING_FACE_ANIMA_REPOSITORY}`,
    revision,
    lastModified: null,
    license: "circlestone-labs-non-commercial-license",
    licenseUrl: "https://huggingface.co/license",
    thumbnailUrl: null,
    files,
  };
  const database = createDatabase({
    databasePath: ":memory:",
    migrationsDir: join(import.meta.dir, "../../drizzle"),
  });
  databases.push(database);
  const repository = new StudioRepository(database);
  const operations = new OperationService(repository);
  const downloader = new FixtureDownloader(
    new Map([
      [files[0]!.sha256, modelBytes],
      [files[1]!.sha256, encoderBytes],
      [files[2]!.sha256, vaeBytes],
    ]),
  );
  const destinations = new DestinationRegistry(
    ["diffusion_models", "text_encoders", "vae"].map((kind) => ({
      id: kind,
      label: kind,
      kind: kind as "diffusion_models" | "text_encoders" | "vae",
      absolutePath: join(root, kind),
    })),
  );
  const createService = (
    selectedDownloader: VerifiedFileDownloader = downloader,
  ) =>
    new HuggingFaceAnimaLibraryService(
      new CatalogClient(catalog),
      selectedDownloader,
      destinations,
      repository,
      operations,
      undefined,
      0,
    );
  return {
    root,
    modelBytes,
    encoderBytes,
    files,
    catalog,
    repository,
    operations,
    downloader,
    destinations,
    createService,
    service: createService(),
  };
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Hugging Face Anima model library", () => {
  test("reports managed installation availability independently of catalog access", async () => {
    const context = await fixture();

    expect(
      context.service.providerStatus(
        false,
        "Managed runtime is required.",
      ),
    ).toMatchObject({
      available: false,
      managedDownloads: false,
      reason: "Managed runtime is required.",
      destinations: [
        { id: "diffusion_models" },
        { id: "text_encoders" },
        { id: "vae" },
      ],
    });
    expect(context.service.providerStatus(true)).toMatchObject({
      available: true,
      managedDownloads: true,
    });
  });

  test("queues a model with its shared encoder and VAE, verifies them, and persists provider identity", async () => {
    const context = await fixture();
    const result = await context.service.install({
      revision,
      path: context.files[0]!.path,
      includeDependencies: true,
      acceptedLicense: true,
    });
    await Promise.all(
      result.downloads.map((download) =>
        context.service.settled(download.id),
      ),
    );

    const completed = context.repository.listModelDownloads(10);
    expect(completed).toHaveLength(3);
    expect(
      completed.every(
        (item) =>
          item.state === "completed" &&
          item.provider === "huggingface",
      ),
    ).toBeTrue();
    expect(
      completed.every(
        (item) =>
          item.providerModelId === HUGGING_FACE_ANIMA_REPOSITORY &&
          item.providerVersionId === revision &&
          item.modelId === null &&
          item.modelVersionId === null,
      ),
    ).toBeTrue();
    expect(
      await readFile(
        join(
          context.root,
          "diffusion_models",
          "anima-base-v1.0.safetensors",
        ),
        "utf8",
      ),
    ).toBe("model");
    expect(context.downloader.order).toHaveLength(3);
  });

  test("downloads a missing file again instead of trusting a stale completed database row", async () => {
    const context = await fixture();
    const first = await context.service.install({
      revision,
      path: context.files[0]!.path,
      includeDependencies: true,
      acceptedLicense: true,
    });
    await Promise.all(
      first.downloads.map((download) =>
        context.service.settled(download.id),
      ),
    );
    const modelPath = join(
      context.root,
      "diffusion_models",
      context.files[0]!.filename,
    );
    await rm(modelPath);

    const second = await context.service.install({
      revision,
      path: context.files[0]!.path,
      includeDependencies: true,
      acceptedLicense: true,
    });
    await Promise.all(
      second.downloads.map((download) =>
        context.service.settled(download.id),
      ),
    );

    expect(second.downloads[0]!.id).not.toBe(first.downloads[0]!.id);
    expect(context.downloader.order).toHaveLength(4);
    expect(await readFile(modelPath, "utf8")).toBe("model");
  });

  test("rejects a dependency filename conflict before queuing any bundle file", async () => {
    const context = await fixture();
    const encoderPath = join(
      context.root,
      "text_encoders",
      context.files[1]!.filename,
    );
    await mkdir(join(context.root, "text_encoders"), {
      recursive: true,
    });
    await writeFile(encoderPath, "changed");

    await expect(
      context.service.install({
        revision,
        path: context.files[0]!.path,
        includeDependencies: true,
        acceptedLicense: true,
      }),
    ).rejects.toMatchObject({
      code: "DOWNLOAD_CONFLICT",
      status: 409,
    });
    expect(context.repository.listModelDownloads(10)).toHaveLength(0);
    expect(context.downloader.order).toHaveLength(0);
  });

  test("indexes an already installed verified file without downloading it again", async () => {
    const context = await fixture();
    const modelPath = join(
      context.root,
      "diffusion_models",
      context.files[0]!.filename,
    );
    await mkdir(join(context.root, "diffusion_models"), {
      recursive: true,
    });
    await writeFile(modelPath, context.modelBytes);

    const result = await context.service.install({
      revision,
      path: context.files[0]!.path,
      includeDependencies: false,
      acceptedLicense: true,
    });

    expect(result.alreadyInstalled).toEqual([
      context.files[0]!.filename,
    ]);
    expect(result.downloads[0]).toMatchObject({
      state: "completed",
      actualSha256: context.files[0]!.sha256,
      metadata: { indexedExistingFile: true },
    });
    expect(context.downloader.order).toHaveLength(0);
  });

  test("retries an interrupted download from its deterministic partial file", async () => {
    const context = await fixture();
    const file = context.files[0]!;
    const operation = context.operations.create(
      "model_download",
      "downloading",
      "Downloading.",
      { provider: "huggingface" },
    );
    context.operations.start(operation.id, "downloading", "Downloading.");
    const interrupted = context.repository.createModelDownload({
      id: "interrupted-hf-download",
      operationId: operation.id,
      state: "downloading",
      provider: "huggingface",
      providerModelId: HUGGING_FACE_ANIMA_REPOSITORY,
      providerVersionId: revision,
      providerFileId: file.path,
      modelName: "CircleStone Labs Anima",
      versionName: revision.slice(0, 12),
      filename: file.filename,
      destinationRootId: "diffusion_models",
      expectedSha256: file.sha256,
      bytesTotal: file.sizeBytes,
    });
    context.service.reconcileInterruptedDownloads();
    const partialBytes = context.modelBytes.slice(0, 2);
    const stagingDirectory = join(
      context.root,
      "diffusion_models",
      ".anima-downloads",
    );
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(
      join(
        stagingDirectory,
        `hf-anima-${file.sha256.slice(0, 20)}.blob.part`,
      ),
      partialBytes,
    );
    let suppliedRange: string | null = "not-called";
    const downloader = new VerifiedResumableFileDownloader(
      (async (_input, init) => {
        suppliedRange = new Headers(init?.headers).get("range");
        return new Response(context.modelBytes.slice(2), {
          status: 206,
          headers: {
            "content-range": `bytes 2-${file.sizeBytes - 1}/${file.sizeBytes}`,
          },
        });
      }) as typeof fetch,
    );
    const restarted = context.createService(downloader);

    const retried = await restarted.retry(interrupted.id);
    const completed = await restarted.settled(retried.id);

    expect(suppliedRange).toBe("bytes=2-");
    expect(completed).toMatchObject({
      state: "completed",
      actualSha256: file.sha256,
      metadata: { retryOf: interrupted.id },
    });
  });
});
