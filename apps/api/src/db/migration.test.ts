import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { StudioRepository } from "./repository";
import * as schema from "./schema";

describe("managed model installation migration", () => {
  test("backfills valid completed files and removes terminal download history", async () => {
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
      CREATE TABLE character_profiles (id text PRIMARY KEY NOT NULL);
      CREATE TABLE character_profile_assets (
        profile_id text NOT NULL,
        asset_id text NOT NULL
      );
      CREATE TABLE model_packs (id text PRIMARY KEY NOT NULL);
      CREATE TABLE generation_batches (id text PRIMARY KEY NOT NULL);
      CREATE TABLE generation_batch_jobs (
        batch_id text NOT NULL,
        job_id text NOT NULL
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
        destination_root_id,
        expected_sha256,
        actual_sha256,
        storage_path,
        completed_at
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
        'loras',
        '${"a".repeat(64)}',
        '${"a".repeat(64)}',
        'C:\\managed\\models\\loras\\old.safetensors',
        '2026-07-30T12:00:00.000Z'
      );
      INSERT INTO system_operations (
        id, kind, status, phase, message
      ) VALUES (
        'invalid-operation', 'model_download', 'completed', 'completed', 'Done'
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
        destination_root_id,
        expected_sha256,
        actual_sha256,
        storage_path,
        completed_at
      ) VALUES (
        'invalid-download',
        'invalid-operation',
        'completed',
        124,
        457,
        790,
        'Changed model',
        'v1',
        'changed.safetensors',
        'loras',
        '${"b".repeat(64)}',
        '${"c".repeat(64)}',
        'C:\\managed\\models\\loras\\changed.safetensors',
        '2026-07-30T12:00:00.000Z'
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
    const migrated = repository.findManagedModelInstallation(
      "old-download",
    );
    const columns = database.sqlite
      .query("PRAGMA table_info(model_downloads)")
      .all() as Array<{ name: string; notnull: number }>;
    const removedTables = database.sqlite
      .query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'character_profile_assets',
             'character_profiles',
             'model_packs',
             'generation_batch_jobs',
             'generation_batches'
           )`,
      )
      .all();

    expect(migrated).toMatchObject({
      provider: "civitai",
      providerModelId: "123",
      providerVersionId: "456",
      providerFileId: "789",
      filename: "old.safetensors",
      sha256: "a".repeat(64),
      storagePath: "C:\\managed\\models\\loras\\old.safetensors",
    });
    expect(repository.findModelDownload("old-download")).toBeNull();
    expect(repository.findSystemOperation("old-operation")).toBeNull();
    expect(
      repository.findManagedModelInstallation("invalid-download"),
    ).toBeNull();
    expect(repository.findModelDownload("invalid-download")).toBeNull();
    expect(
      repository.findSystemOperation("invalid-operation"),
    ).toBeNull();
    expect(
      columns
        .filter((column) =>
          ["model_id", "model_version_id"].includes(column.name),
        )
        .every((column) => column.notnull === 0),
    ).toBeTrue();
    expect(removedTables).toEqual([]);

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
