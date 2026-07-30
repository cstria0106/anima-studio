import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { StudioRepository } from "./repository";
import * as schema from "./schema";

describe("model download identity migration", () => {
  test("repairs the previously applied append-only migration and backfills Civitai identity", async () => {
    const legacy = new Database(":memory:", { create: true });
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('previous-0005', 1785416400000);
      CREATE TABLE system_operations (
        id text PRIMARY KEY NOT NULL,
        kind text NOT NULL,
        status text NOT NULL,
        phase text NOT NULL,
        message text DEFAULT '' NOT NULL,
        progress integer,
        metadata_json text DEFAULT '{}' NOT NULL,
        error text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        started_at text,
        completed_at text
      );
      CREATE TABLE system_operation_events (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        operation_id text NOT NULL,
        phase text NOT NULL,
        message text NOT NULL,
        progress integer,
        current integer,
        total integer,
        bytes_completed integer,
        bytes_total integer,
        bytes_per_second integer,
        payload_json text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (operation_id) REFERENCES system_operations(id)
          ON DELETE cascade
      );
      CREATE TABLE model_downloads (
        id text PRIMARY KEY NOT NULL,
        operation_id text NOT NULL,
        state text NOT NULL,
        provider text DEFAULT 'civitai' NOT NULL,
        provider_download_id text,
        model_id integer NOT NULL,
        model_version_id integer NOT NULL,
        file_id integer,
        model_name text NOT NULL,
        version_name text NOT NULL,
        filename text NOT NULL,
        destination_root_id text NOT NULL,
        relative_dir text DEFAULT '' NOT NULL,
        expected_sha256 text,
        actual_sha256 text,
        bytes_completed integer DEFAULT 0 NOT NULL,
        bytes_total integer,
        bytes_per_second integer,
        trigger_words_json text DEFAULT '[]' NOT NULL,
        metadata_json text DEFAULT '{}' NOT NULL,
        storage_path text,
        error text,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        completed_at text,
        provider_model_id text DEFAULT '' NOT NULL,
        provider_version_id text DEFAULT '' NOT NULL,
        provider_file_id text,
        FOREIGN KEY (operation_id) REFERENCES system_operations(id)
          ON DELETE cascade
      );
      INSERT INTO system_operations (
        id, kind, status, phase, message
      ) VALUES (
        'old-operation', 'model_download', 'completed', 'completed', 'Done'
      );
      INSERT INTO model_downloads (
        id,
        operation_id,
        state,
        model_id,
        model_version_id,
        file_id,
        model_name,
        version_name,
        filename,
        destination_root_id
      ) VALUES (
        'old-download',
        'old-operation',
        'completed',
        123,
        456,
        789,
        'Old model',
        'v1',
        'old.safetensors',
        'loras'
      );
    `);
    const db = drizzle(legacy, { schema });
    migrate(db, {
      migrationsFolder: join(import.meta.dir, "../../drizzle"),
    });
    const database = {
      sqlite: legacy,
      db,
      close: () => legacy.close(),
    };
    const repository = new StudioRepository(database);
    const migrated = repository.findModelDownload("old-download");
    const columns = database.sqlite
      .query("PRAGMA table_info(model_downloads)")
      .all() as Array<{ name: string; notnull: number }>;

    expect(migrated).toMatchObject({
      provider: "civitai",
      providerModelId: "123",
      providerVersionId: "456",
      providerFileId: "789",
      modelId: 123,
      modelVersionId: 456,
      fileId: 789,
    });
    expect(
      columns
        .filter((column) =>
          ["model_id", "model_version_id"].includes(column.name),
        )
        .every((column) => column.notnull === 0),
    ).toBeTrue();

    const operation = repository.createSystemOperation({
      id: "hf-operation",
      kind: "model_download",
      status: "queued",
      phase: "queued",
      message: "Queued",
    });
    const huggingFace = repository.createModelDownload({
      id: "hf-download",
      operationId: operation.id,
      state: "queued",
      provider: "huggingface",
      providerModelId: "circlestone-labs/Anima",
      providerVersionId: "f".repeat(40),
      providerFileId:
        "split_files/diffusion_models/anima-base-v1.0.safetensors",
      modelName: "Anima",
      versionName: "main",
      filename: "anima-base-v1.0.safetensors",
      destinationRootId: "diffusion_models",
    });

    expect(huggingFace).toMatchObject({
      provider: "huggingface",
      modelId: null,
      modelVersionId: null,
    });
    database.close();
  });
});
