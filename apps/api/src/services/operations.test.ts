import { afterEach, describe, expect, test } from "bun:test";
import { createDatabase, type DatabaseContext } from "../db/database";
import { StudioRepository } from "../db/repository";
import { loadConfig } from "../config";
import { OperationService } from "./operations";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function services() {
  const config = loadConfig({
    databasePath: ":memory:",
    dataDir: "data",
  });
  const database = createDatabase(config);
  databases.push(database);
  const repository = new StudioRepository(database);
  return {
    repository,
    operations: new OperationService(repository),
  };
}

describe("system operations persistence", () => {
  test("persists ordered progress and terminal state", () => {
    const { repository, operations } = services();
    const created = operations.create(
      "runtime_install",
      "preflight",
      "Checking the computer.",
    );
    operations.start(created.id, "downloading", "Downloading engine.");
    operations.report(created.id, {
      phase: "downloading",
      message: "Downloading engine.",
      progress: 40,
      bytesCompleted: 40,
      bytesTotal: 100,
      bytesPerSecond: 12,
    });
    const completed = operations.complete(
      created.id,
      "completed",
      "Engine installed.",
    );

    expect(completed).toMatchObject({
      status: "completed",
      phase: "completed",
      progress: 100,
    });
    const events = repository.listSystemOperationEvents(created.id);
    expect(events.map((event) => event.phase)).toEqual([
      "preflight",
      "downloading",
      "downloading",
      "completed",
    ]);
    expect(events[2]).toMatchObject({
      bytesCompleted: 40,
      bytesTotal: 100,
      bytesPerSecond: 12,
    });
  });

  test("stores model download lineage and verification hashes", () => {
    const { repository, operations } = services();
    const operation = operations.create(
      "model_download",
      "resolving",
      "Resolving Civitai model.",
    );
    const download = repository.createModelDownload({
      id: crypto.randomUUID(),
      operationId: operation.id,
      state: "queued",
      modelId: 10,
      modelVersionId: 20,
      fileId: 30,
      modelName: "Test model",
      versionName: "v1",
      filename: "test.safetensors",
      destinationRootId: "loras",
      expectedSha256: "a".repeat(64),
      triggerWords: ["test trigger"],
    });
    const completed = repository.updateModelDownload(download.id, {
      state: "completed",
      actualSha256: "a".repeat(64),
      bytesCompleted: 123,
      bytesTotal: 123,
      completedAt: new Date().toISOString(),
    });

    expect(completed).toMatchObject({
      operationId: operation.id,
      state: "completed",
      expectedSha256: "a".repeat(64),
      actualSha256: "a".repeat(64),
      triggerWords: ["test trigger"],
    });
  });
});
