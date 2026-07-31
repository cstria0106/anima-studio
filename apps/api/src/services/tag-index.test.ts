import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { createDatabase } from "../db/database";
import { StudioRepository } from "../db/repository";
import {
  initializeDanbooruTagIndex,
  type TagDataSource,
} from "./tag-index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  // bun:sqlite keeps cached query statements alive until their repository is
  // collected, which holds the WAL files open on Windows after close().
  Bun.gc(true);
  await Bun.sleep(10);
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

async function fixture(): Promise<{
  directory: string;
  databasePath: string;
  migrationsDir: string;
  source: TagDataSource;
}> {
  const directory = await mkdtemp(join(tmpdir(), "anima-tags-test-"));
  temporaryDirectories.push(directory);
  const tagsCsvPath = join(directory, "danbooru_tags.csv");
  const cooccurrenceCsvPath = join(
    directory,
    "danbooru_tags_cooccurrence.csv",
  );
  const manifestPath = join(directory, "manifest.json");
  await Bun.write(
    tagsCsvPath,
    [
      "tag,category,count,alias",
      '1girl,0,1000,"1girls,sole_female"',
      'red_eyes,0,900,"scarlet_eyes"',
      "white_pupils,0,500,",
      "solo,0,800,",
    ].join("\n"),
  );
  await Bun.write(
    cooccurrenceCsvPath,
    [
      "tag_a,tag_b,count",
      "1girl,red_eyes,700.0",
      "1girl,solo,600.0",
      "red_eyes,white_pupils,450.0",
    ].join("\n"),
  );
  await Bun.write(manifestPath, '{"version":1,"fixture":true}\n');
  const config = loadConfig({
    DATABASE_PATH: join(directory, "studio.sqlite"),
    DATA_DIR: directory,
  });
  return {
    directory,
    databasePath: config.databasePath,
    migrationsDir: config.migrationsDir,
    source: {
      tagsCsvPath,
      cooccurrenceCsvPath,
      manifestPath,
      minimumCooccurrenceCount: 0,
    },
  };
}

describe("Danbooru tag index", () => {
  test("imports tags, aliases, and cooccurrences then skips an unchanged reopen", async () => {
    const files = await fixture();
    const firstDatabase = createDatabase(files);
    const firstRepository = new StudioRepository(firstDatabase);
    const first = await initializeDanbooruTagIndex(
      firstRepository,
      files.source,
    );

    expect(first).toMatchObject({
      imported: true,
      metadata: {
        source: "danbooru",
        tagCount: 4,
        cooccurrenceCount: 3,
      },
    });
    expect(firstRepository.searchTags("scarlet")).toMatchObject([
      { tag: "red eyes", aliases: ["scarlet eyes"] },
    ]);
    expect(firstRepository.searchTags("r")).toEqual([
      expect.objectContaining({ tag: "red eyes" }),
    ]);
    expect(firstRepository.relatedTags(["1girl"], "red")).toEqual([
      expect.objectContaining({
        tag: "red eyes",
        cooccurrenceCount: 700,
        matchedContext: ["1girl"],
      }),
    ]);
    firstDatabase.close();

    const reopenedDatabase = createDatabase(files);
    const reopenedRepository = new StudioRepository(reopenedDatabase);
    const reopened = await initializeDanbooruTagIndex(
      reopenedRepository,
      files.source,
    );
    expect(reopened.imported).toBe(false);
    expect(reopened.metadata.fingerprint).toBe(first.metadata.fingerprint);
    expect(reopenedRepository.tagIndexCounts()).toEqual({
      tagCount: 4,
      cooccurrenceCount: 3,
    });
    reopenedDatabase.close();
  });

  test("uses multiple prompt tags to rank contextual suggestions", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    await initializeDanbooruTagIndex(repository, files.source);

    expect(repository.searchTags("", 3, ["1girl", "red eyes"])).toEqual([
      expect.objectContaining({
        tag: "solo",
        cooccurrenceCount: 600,
        matchedContext: ["1girl"],
      }),
      expect.objectContaining({
        tag: "white pupils",
        cooccurrenceCount: 450,
        matchedContext: ["red eyes"],
      }),
    ]);
    database.close();
  });
});
