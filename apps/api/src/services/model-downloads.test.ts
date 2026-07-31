import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDatabase, type DatabaseContext } from "../db/database";
import { StudioRepository } from "../db/repository";
import { DestinationRegistry, NodeFileHasher } from "../civitai";
import { OperationService } from "./operations";
import { ModelDownloadCoordinator } from "./model-downloads";

const databases: DatabaseContext[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture(
  hasher: Pick<NodeFileHasher, "sha256"> = new NodeFileHasher(),
) {
  const root = join(tmpdir(), `anima-installations-${crypto.randomUUID()}`);
  directories.push(root);
  const modelRoot = join(root, "models");
  const loraRoot = join(modelRoot, "loras");
  const encoderRoot = join(modelRoot, "text_encoders");
  await Promise.all([
    mkdir(loraRoot, { recursive: true }),
    mkdir(encoderRoot, { recursive: true }),
  ]);
  const database = createDatabase({
    databasePath: ":memory:",
    migrationsDir: join(import.meta.dir, "../../drizzle"),
  });
  databases.push(database);
  const repository = new StudioRepository(database);
  const operations = new OperationService(repository);
  const destinations = new DestinationRegistry([
    {
      id: "loras",
      label: "LoRA",
      kind: "loras",
      absolutePath: loraRoot,
    },
    {
      id: "text_encoders",
      label: "Text Encoder",
      kind: "text_encoders",
      absolutePath: encoderRoot,
    },
  ]);
  const settler = {
    async settled(id: string) {
      const download = repository.findModelDownload(id);
      if (!download) throw new Error("missing test download");
      return download;
    },
  };
  const coordinator = new ModelDownloadCoordinator(
    repository,
    settler,
    settler,
    destinations,
    join(root, "removal-staging"),
    hasher,
  );
  return {
    root,
    loraRoot,
    encoderRoot,
    repository,
    operations,
    coordinator,
  };
}

async function completedDownload(
  context: Awaited<ReturnType<typeof fixture>>,
  input: {
    id: string;
    providerFileId: string;
    filename: string;
    destinationRootId: "loras" | "text_encoders";
    storagePath: string;
    providerVersionId?: string;
  },
) {
  const bytes = new TextEncoder().encode(input.id);
  await writeFile(input.storagePath, bytes);
  const sha256 = await new NodeFileHasher().sha256(input.storagePath);
  const operation = context.operations.create(
    "model_download",
    "downloading",
    "Installing",
  );
  context.operations.start(operation.id, "downloading", "Installing");
  let download = context.repository.createModelDownload({
    id: input.id,
    operationId: operation.id,
    state: "downloading",
    provider: "huggingface",
    providerModelId: "circlestone-labs/Anima",
    providerVersionId: input.providerVersionId ?? "f".repeat(40),
    providerFileId: input.providerFileId,
    modelName: "Anima",
    versionName: "latest",
    filename: input.filename,
    destinationRootId: input.destinationRootId,
    expectedSha256: sha256,
    bytesTotal: bytes.byteLength,
  });
  download =
    context.repository.updateModelDownload(input.id, {
      state: "completed",
      actualSha256: sha256,
      bytesCompleted: bytes.byteLength,
      storagePath: input.storagePath,
      completedAt: new Date().toISOString(),
    }) ?? download;
  context.operations.complete(
    operation.id,
    "completed",
    "Installed",
  );
  return download;
}

describe("managed model installations", () => {
  test("persists current installation state and removes terminal task records", async () => {
    const context = await fixture();
    const filePath = join(context.loraRoot, "character.safetensors");
    const download = await completedDownload(context, {
      id: "completed-download",
      providerFileId: "split_files/character.safetensors",
      filename: "character.safetensors",
      destinationRootId: "loras",
      storagePath: filePath,
    });

    const task = context.coordinator.track([download], download.id);
    const settled = await context.coordinator.settledTask(
      task.installationId,
    );

    expect(settled).toEqual({
      installationId: task.installationId,
      status: "installed",
      progress: 100,
    });
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).toMatchObject({
      providerFileId: "split_files/character.safetensors",
      storagePath: filePath,
    });
    expect(context.repository.findModelDownload(download.id)).toBeNull();
    expect(
      context.repository.findSystemOperation(download.operationId),
    ).toBeNull();
  });

  test("keeps a shared dependency alive until every concurrent bundle is installed", async () => {
    const context = await fixture();
    const [baseDownload, turboDownload, encoderDownload] =
      await Promise.all([
        completedDownload(context, {
          id: "base-download",
          providerFileId:
            "split_files/diffusion_models/anima-base-v1.0.safetensors",
          filename: "anima-base-v1.0.safetensors",
          destinationRootId: "loras",
          storagePath: join(
            context.loraRoot,
            "anima-base-v1.0.safetensors",
          ),
        }),
        completedDownload(context, {
          id: "turbo-download",
          providerFileId:
            "split_files/diffusion_models/anima-turbo-v1.0.safetensors",
          filename: "anima-turbo-v1.0.safetensors",
          destinationRootId: "loras",
          storagePath: join(
            context.loraRoot,
            "anima-turbo-v1.0.safetensors",
          ),
        }),
        completedDownload(context, {
          id: "shared-encoder-download",
          providerFileId:
            "split_files/text_encoders/shared-encoder.safetensors",
          filename: "shared-encoder.safetensors",
          destinationRootId: "text_encoders",
          storagePath: join(
            context.encoderRoot,
            "shared-encoder.safetensors",
          ),
        }),
      ]);

    const baseTask = context.coordinator.track(
      [baseDownload, encoderDownload],
      baseDownload.id,
    );
    const turboTask = context.coordinator.track(
      [turboDownload, encoderDownload],
      turboDownload.id,
    );
    const [baseResult, turboResult] = await Promise.all([
      context.coordinator.settledTask(baseTask.installationId),
      context.coordinator.settledTask(turboTask.installationId),
    ]);

    expect(baseResult.status).toBe("installed");
    expect(turboResult.status).toBe("installed");
    expect(context.repository.listManagedModelInstallations()).toHaveLength(
      3,
    );
    expect(
      context.repository.findManagedModelInstallationByProviderFile(
        "huggingface",
        "circlestone-labs/Anima",
        "f".repeat(40),
        "split_files/text_encoders/shared-encoder.safetensors",
      ),
    ).not.toBeNull();
    expect(
      context.repository.findModelDownload(encoderDownload.id),
    ).toBeNull();
    expect(
      context.repository.findSystemOperation(encoderDownload.operationId),
    ).toBeNull();
  });

  test("uses durable dependency state when a reused download row was already cleaned", async () => {
    const context = await fixture();
    const [baseDownload, turboDownload, encoderDownload] =
      await Promise.all([
        completedDownload(context, {
          id: "early-base-download",
          providerFileId:
            "split_files/diffusion_models/anima-base-v1.0.safetensors",
          filename: "anima-base-v1.0.safetensors",
          destinationRootId: "loras",
          storagePath: join(
            context.loraRoot,
            "anima-base-v1.0.safetensors",
          ),
        }),
        completedDownload(context, {
          id: "late-turbo-download",
          providerFileId:
            "split_files/diffusion_models/anima-turbo-v1.0.safetensors",
          filename: "anima-turbo-v1.0.safetensors",
          destinationRootId: "loras",
          storagePath: join(
            context.loraRoot,
            "anima-turbo-v1.0.safetensors",
          ),
        }),
        completedDownload(context, {
          id: "captured-encoder-download",
          providerFileId:
            "split_files/text_encoders/captured-encoder.safetensors",
          filename: "captured-encoder.safetensors",
          destinationRootId: "text_encoders",
          storagePath: join(
            context.encoderRoot,
            "captured-encoder.safetensors",
          ),
        }),
      ]);
    const baseTask = context.coordinator.track(
      [baseDownload, encoderDownload],
      baseDownload.id,
    );
    await context.coordinator.settledTask(baseTask.installationId);
    expect(
      context.repository.findModelDownload(encoderDownload.id),
    ).toBeNull();

    const turboTask = context.coordinator.track(
      [turboDownload, encoderDownload],
      turboDownload.id,
    );
    const turboResult = await context.coordinator.settledTask(
      turboTask.installationId,
    );

    expect(turboResult.status).toBe("installed");
    expect(context.repository.listManagedModelInstallations()).toHaveLength(
      3,
    );
  });

  test("replaces an older revision that owns the same installed path", async () => {
    const context = await fixture();
    const encoderPath = join(
      context.encoderRoot,
      "shared-encoder.safetensors",
    );
    const newDownload = await completedDownload(context, {
      id: "new-revision-download",
      providerFileId:
        "split_files/text_encoders/shared-encoder.safetensors",
      filename: "shared-encoder.safetensors",
      destinationRootId: "text_encoders",
      storagePath: encoderPath,
      providerVersionId: "f".repeat(40),
    });
    context.repository.upsertManagedModelInstallation({
      id: "old-revision-installation",
      provider: "huggingface",
      providerModelId: "circlestone-labs/Anima",
      providerVersionId: "e".repeat(40),
      providerFileId:
        "split_files/text_encoders/shared-encoder.safetensors",
      modelName: "Anima",
      versionName: "old",
      filename: "shared-encoder.safetensors",
      destinationRootId: "text_encoders",
      sha256: newDownload.actualSha256!,
      storagePath: encoderPath,
    });

    const task = context.coordinator.track(
      [newDownload],
      newDownload.id,
    );
    const settled = await context.coordinator.settledTask(
      task.installationId,
    );

    expect(settled.status).toBe("installed");
    expect(
      context.repository.findManagedModelInstallation(
        "old-revision-installation",
      ),
    ).toBeNull();
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).toMatchObject({
      providerVersionId: "f".repeat(40),
      storagePath: encoderPath,
    });
  });

  test("rolls back every installation when one bundle row conflicts", async () => {
    const context = await fixture();
    context.repository.upsertManagedModelInstallation({
      id: "occupied-installation-id",
      provider: "civitai",
      providerModelId: "existing-model",
      providerVersionId: "existing-version",
      providerFileId: "existing-file",
      modelName: "Existing",
      versionName: "v1",
      filename: "existing.safetensors",
      destinationRootId: "loras",
      sha256: "a".repeat(64),
      storagePath: join(context.loraRoot, "existing.safetensors"),
    });

    expect(() =>
      context.repository.upsertManagedModelInstallations([
        {
          id: "first-bundle-installation",
          provider: "civitai",
          providerModelId: "first-model",
          providerVersionId: "first-version",
          providerFileId: "first-file",
          modelName: "First",
          versionName: "v1",
          filename: "first.safetensors",
          destinationRootId: "loras",
          sha256: "b".repeat(64),
          storagePath: join(context.loraRoot, "first.safetensors"),
        },
        {
          id: "occupied-installation-id",
          provider: "civitai",
          providerModelId: "second-model",
          providerVersionId: "second-version",
          providerFileId: "second-file",
          modelName: "Second",
          versionName: "v1",
          filename: "second.safetensors",
          destinationRootId: "loras",
          sha256: "c".repeat(64),
          storagePath: join(context.loraRoot, "second.safetensors"),
        },
      ]),
    ).toThrow();
    expect(
      context.repository.findManagedModelInstallation(
        "first-bundle-installation",
      ),
    ).toBeNull();
    expect(
      context.repository.findManagedModelInstallation(
        "occupied-installation-id",
      ),
    ).toMatchObject({
      providerModelId: "existing-model",
      storagePath: join(context.loraRoot, "existing.safetensors"),
    });
    expect(context.repository.listManagedModelInstallations()).toHaveLength(
      1,
    );
  });

  test("fails safely and cleans transient rows when bundle persistence throws", async () => {
    const context = await fixture();
    const filePath = join(context.loraRoot, "persistence-error.safetensors");
    const download = await completedDownload(context, {
      id: "persistence-error-download",
      providerFileId: "models/persistence-error.safetensors",
      filename: "persistence-error.safetensors",
      destinationRootId: "loras",
      storagePath: filePath,
    });
    context.repository.upsertManagedModelInstallations = () => {
      throw new Error("sensitive database details");
    };

    const task = context.coordinator.track([download], download.id);
    const settled = await context.coordinator.settledTask(
      task.installationId,
    );

    expect(settled).toMatchObject({
      status: "failed",
      progress: 0,
      error: "The model installation could not be saved.",
    });
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).toBeNull();
    expect(context.repository.findModelDownload(download.id)).toBeNull();
    expect(
      context.repository.findSystemOperation(download.operationId),
    ).toBeNull();
  });

  test("removes only the selected verified regular file and keeps shared dependencies", async () => {
    const context = await fixture();
    const modelPath = join(context.loraRoot, "character.safetensors");
    const encoderPath = join(
      context.encoderRoot,
      "shared-encoder.safetensors",
    );
    const [modelDownload, encoderDownload] = await Promise.all([
      completedDownload(context, {
        id: "model-download",
        providerFileId: "models/character.safetensors",
        filename: "character.safetensors",
        destinationRootId: "loras",
        storagePath: modelPath,
      }),
      completedDownload(context, {
        id: "encoder-download",
        providerFileId: "text_encoders/shared-encoder.safetensors",
        filename: "shared-encoder.safetensors",
        destinationRootId: "text_encoders",
        storagePath: encoderPath,
      }),
    ]);
    const task = context.coordinator.track(
      [modelDownload, encoderDownload],
      modelDownload.id,
    );
    await context.coordinator.settledTask(task.installationId);
    const encoder = context.repository
      .listManagedModelInstallations()
      .find((item) => item.filename === "shared-encoder.safetensors")!;

    await context.coordinator.remove(task.installationId);

    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).toBeNull();
    expect(
      context.repository.findManagedModelInstallation(encoder.id),
    ).not.toBeNull();
    expect(await readFile(encoderPath, "utf8")).toBe("encoder-download");
    await expect(readFile(modelPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("refuses removal when the installed file hash has changed", async () => {
    const context = await fixture();
    const filePath = join(context.loraRoot, "changed.safetensors");
    const download = await completedDownload(context, {
      id: "changed-download",
      providerFileId: "models/changed.safetensors",
      filename: "changed.safetensors",
      destinationRootId: "loras",
      storagePath: filePath,
    });
    const task = context.coordinator.track([download], download.id);
    await context.coordinator.settledTask(task.installationId);
    await writeFile(filePath, "modified");

    await expect(
      context.coordinator.remove(task.installationId),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH", status: 409 });
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).not.toBeNull();
    expect(await readFile(filePath, "utf8")).toBe("modified");
  });

  test("refuses removal while another revision targets the same file path", async () => {
    const context = await fixture();
    const filePath = join(
      context.encoderRoot,
      "revision-shared.safetensors",
    );
    const installedDownload = await completedDownload(context, {
      id: "installed-revision-download",
      providerFileId:
        "split_files/text_encoders/revision-shared.safetensors",
      filename: "revision-shared.safetensors",
      destinationRootId: "text_encoders",
      storagePath: filePath,
      providerVersionId: "e".repeat(40),
    });
    const installedTask = context.coordinator.track(
      [installedDownload],
      installedDownload.id,
    );
    await context.coordinator.settledTask(installedTask.installationId);
    const operation = context.operations.create(
      "model_download",
      "downloading",
      "Installing newer revision",
    );
    context.operations.start(
      operation.id,
      "downloading",
      "Installing newer revision",
    );
    const activeDownload = context.repository.createModelDownload({
      id: "active-revision-download",
      operationId: operation.id,
      state: "downloading",
      provider: "huggingface",
      providerModelId: "circlestone-labs/Anima",
      providerVersionId: "f".repeat(40),
      providerFileId:
        "split_files/text_encoders/revision-shared.safetensors",
      modelName: "Anima",
      versionName: "latest",
      filename: "revision-shared.safetensors",
      destinationRootId: "text_encoders",
      expectedSha256: "a".repeat(64),
    });
    const activeTask = context.coordinator.track(
      [activeDownload],
      activeDownload.id,
    );

    await expect(
      context.coordinator.remove(installedTask.installationId),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED", status: 409 });
    expect(await readFile(filePath, "utf8")).toBe(
      "installed-revision-download",
    );
    expect(
      context.repository.findManagedModelInstallation(
        installedTask.installationId,
      ),
    ).not.toBeNull();
    expect(
      await context.coordinator.settledTask(activeTask.installationId),
    ).toMatchObject({ status: "failed" });
  });

  test("restores the file and registry when its staged hash changes", async () => {
    const nodeHasher = new NodeFileHasher();
    let hashCalls = 0;
    const context = await fixture({
      async sha256(filePath: string) {
        hashCalls += 1;
        const actual = await nodeHasher.sha256(filePath);
        return hashCalls === 1 ? actual : "0".repeat(64);
      },
    });
    const filePath = join(context.loraRoot, "staged-change.safetensors");
    const download = await completedDownload(context, {
      id: "staged-change-download",
      providerFileId: "models/staged-change.safetensors",
      filename: "staged-change.safetensors",
      destinationRootId: "loras",
      storagePath: filePath,
    });
    const task = context.coordinator.track([download], download.id);
    await context.coordinator.settledTask(task.installationId);

    await expect(
      context.coordinator.remove(task.installationId),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH", status: 409 });
    expect(hashCalls).toBe(2);
    expect(await readFile(filePath, "utf8")).toBe(
      "staged-change-download",
    );
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).not.toBeNull();
    expect(
      await readdir(join(context.root, "removal-staging")),
    ).toHaveLength(0);
  });

  test("cleans failed task and operation records without creating an installation", async () => {
    const context = await fixture();
    const operation = context.operations.create(
      "model_download",
      "downloading",
      "Installing",
    );
    context.operations.start(operation.id, "downloading", "Installing");
    let download = context.repository.createModelDownload({
      id: "failed-download",
      operationId: operation.id,
      state: "downloading",
      provider: "civitai",
      providerModelId: "123",
      providerVersionId: "456",
      providerFileId: "789",
      modelName: "Failed",
      versionName: "v1",
      filename: "failed.safetensors",
      destinationRootId: "loras",
      expectedSha256: "a".repeat(64),
    });
    download =
      context.repository.updateModelDownload(download.id, {
        state: "failed",
        error: "Network unavailable",
        completedAt: new Date().toISOString(),
      }) ?? download;
    context.operations.fail(
      operation.id,
      new Error("Network unavailable"),
    );

    const task = context.coordinator.track([download], download.id);
    const settled = await context.coordinator.settledTask(
      task.installationId,
    );

    expect(settled).toMatchObject({
      status: "failed",
      progress: 0,
      error: "Network unavailable",
    });
    expect(
      context.repository.findManagedModelInstallation(task.installationId),
    ).toBeNull();
    expect(context.repository.findModelDownload(download.id)).toBeNull();
    expect(
      context.repository.findSystemOperation(operation.id),
    ).toBeNull();
  });

  test("reconciles stale installation records and interrupted task rows at startup", async () => {
    const context = await fixture();
    const validPath = join(context.loraRoot, "valid.safetensors");
    await writeFile(validPath, "valid");
    const validSha256 = await new NodeFileHasher().sha256(validPath);
    context.repository.upsertManagedModelInstallation({
      id: "valid-installation",
      provider: "civitai",
      providerModelId: "10",
      providerVersionId: "20",
      providerFileId: "30",
      modelName: "Valid",
      versionName: "v1",
      filename: "valid.safetensors",
      destinationRootId: "loras",
      sha256: validSha256,
      storagePath: validPath,
    });
    context.repository.upsertManagedModelInstallation({
      id: "missing-installation",
      provider: "civitai",
      providerModelId: "11",
      providerVersionId: "21",
      providerFileId: "31",
      modelName: "Missing",
      versionName: "v1",
      filename: "missing.safetensors",
      destinationRootId: "loras",
      sha256: "a".repeat(64),
      storagePath: join(context.loraRoot, "missing.safetensors"),
    });
    const operation = context.operations.create(
      "model_download",
      "downloading",
      "Interrupted",
    );
    context.repository.createModelDownload({
      id: "interrupted-task",
      operationId: operation.id,
      state: "downloading",
      providerModelId: "12",
      providerVersionId: "22",
      providerFileId: "32",
      modelName: "Interrupted",
      versionName: "v1",
      filename: "interrupted.safetensors",
      destinationRootId: "loras",
    });

    await context.coordinator.reconcileInstallations();

    expect(
      context.repository.findManagedModelInstallation("valid-installation"),
    ).not.toBeNull();
    expect(
      context.repository.findManagedModelInstallation("missing-installation"),
    ).toBeNull();
    expect(
      context.repository.findModelDownload("interrupted-task"),
    ).toBeNull();
    expect(
      context.repository.findSystemOperation(operation.id),
    ).toBeNull();
  });

  test("decorates only current recommended Anima models from installation state", async () => {
    const context = await fixture();
    const filePath = join(context.loraRoot, "anima-base-v1.0.safetensors");
    const download = await completedDownload(context, {
      id: "anima-base-download",
      providerFileId:
        "split_files/diffusion_models/anima-base-v1.0.safetensors",
      filename: "anima-base-v1.0.safetensors",
      destinationRootId: "loras",
      storagePath: filePath,
    });
    const task = context.coordinator.track([download], download.id);
    await context.coordinator.settledTask(task.installationId);
    const file = (
      filename: string,
      recommended: boolean,
      experimental: boolean,
    ) => ({
      path: `split_files/diffusion_models/${filename}`,
      filename,
      kind: "diffusion_model" as const,
      destinationRootId: "diffusion_models" as const,
      sizeBytes: 1,
      sha256: "a".repeat(64),
      recommended,
      experimental,
      installationId: null,
      installationStatus: "not_installed" as const,
      installationProgress: null,
    });
    const decorated = context.coordinator.decorateAnima({
      provider: "huggingface",
      repository: "circlestone-labs/Anima",
      sourceUrl: "https://huggingface.co/circlestone-labs/Anima",
      revision: "f".repeat(40),
      lastModified: null,
      license: "test",
      licenseUrl: "https://huggingface.co/license",
      thumbnailUrl: null,
      files: [
        file("anima-base-v1.0.safetensors", true, false),
        file("anima-aesthetic-v1.0.safetensors", false, false),
        file("anima-preview.safetensors", true, true),
      ],
    });

    expect(decorated.files).toHaveLength(1);
    expect(decorated.files[0]).toMatchObject({
      filename: "anima-base-v1.0.safetensors",
      installationId: task.installationId,
      installationStatus: "installed",
      installationProgress: 100,
    });
    expect(
      context.coordinator.current(
        "huggingface",
        "circlestone-labs/Anima",
        "e".repeat(40),
        "split_files/diffusion_models/anima-base-v1.0.safetensors",
      ),
    ).toEqual({
      installationId: task.installationId,
      status: "installed",
      progress: 100,
    });
  });
});
