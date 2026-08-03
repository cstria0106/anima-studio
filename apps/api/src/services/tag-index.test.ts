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
  const descriptionsCsvPath = join(directory, "danbooru_tags_ko.csv");
  await Bun.write(
    descriptionsCsvPath,
    [
      "tag,description",
      'red eyes,"[눈] 붉은 눈. 키워드: 빨간 눈, 적안"',
      'wishiwashi (solo),"약어귀 단독 형태"',
    ].join("\n"),
  );
  await Bun.write(
    tagsCsvPath,
    [
      "tag,category,count,alias",
      '1girl,0,1000,"1girls,sole_female"',
      'red_eyes,0,900,"scarlet_eyes"',
      "white_pupils,0,500,",
      "solo,0,800,",
      "=_=,0,29526,",
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
  const config = loadConfig({
    databasePath: join(directory, "studio.sqlite"),
    dataDir: directory,
  });
  return {
    directory,
    databasePath: config.databasePath,
    migrationsDir: config.migrationsDir,
    source: {
      tagsCsvPath,
      descriptionsCsvPath,
      cooccurrenceCsvPath,
      minimumCooccurrenceCount: 0,
    },
  };
}

function replaceAutocompleteRankingFixture(repository: StudioRepository): void {
  repository.replaceTagIndex(
    [
      {
        tag: "1girl",
        category: "general",
        count: 1_000,
        description: "",
      },
      {
        tag: "solo",
        category: "general",
        count: 800,
        description: "",
        aliases: ["female solo", "solo female"],
      },
      {
        tag: "solo focus",
        category: "general",
        count: 700,
        description: "",
      },
      {
        tag: "solosis",
        category: "character",
        count: 700,
        description: "",
      },
      {
        tag: "@solokitsune",
        category: "artist",
        count: 375,
        description: "",
      },
      {
        tag: "wishiwashi (solo)",
        category: "character",
        count: 400,
        description: "",
      },
      {
        tag: "ensemble",
        category: "general",
        count: 10_000,
        description: "",
        aliases: ["solo ensemble"],
      },
      {
        tag: "chorus",
        category: "general",
        count: 9_000,
        description: "solo performance",
      },
    ],
    [
      { tag: "1girl", relatedTag: "solo", count: 100 },
      { tag: "1girl", relatedTag: "solo focus", count: 1_000 },
      { tag: "1girl", relatedTag: "solosis", count: 2_000 },
      { tag: "1girl", relatedTag: "wishiwashi (solo)", count: 5_000 },
      { tag: "1girl", relatedTag: "ensemble", count: 9_000 },
    ],
    {
      fingerprint: "autocomplete-ranking-fixture",
      source: "danbooru",
      minimumCooccurrenceCount: 0,
    },
  );
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
        tagCount: 28,
        cooccurrenceCount: 3,
      },
    });
    expect(firstRepository.searchTags("scarlet")).toMatchObject([
      { tag: "red eyes", aliases: ["scarlet eyes"] },
    ]);
    expect(firstRepository.searchTags("빨간 눈", 1)).toMatchObject([
      { tag: "red eyes", description: expect.stringContaining("붉은 눈") },
    ]);
    expect(firstRepository.searchTags("r")).toContainEqual(
      expect.objectContaining({ tag: "red eyes" }),
    );
    expect(firstRepository.searchTags("=_=", 1)).toEqual([
      expect.objectContaining({ tag: "=_=", insertText: "=_=" }),
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
      tagCount: 28,
      cooccurrenceCount: 3,
    });
    reopenedDatabase.close();
  });

  test("uses multiple prompt tags to rank contextual suggestions", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    await initializeDanbooruTagIndex(repository, files.source);

    expect(
      repository.searchTags("", 3, ["1girl", "red eyes"]).slice(0, 2),
    ).toEqual([
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

  test("ranks canonical lexical tiers before popularity and LIMIT", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    const expected = [
      "solo",
      "solo focus",
      "solosis",
      "wishiwashi (solo)",
      "@solokitsune",
      "ensemble",
      "chorus",
    ];
    expect(repository.searchTags("solo", 1).map(({ tag }) => tag)).toEqual([
      "solo",
    ]);
    expect(repository.searchTags("solo", 20).map(({ tag }) => tag)).toEqual(
      expected,
    );

    database.sqlite.exec("DROP TABLE tag_search");
    expect(repository.searchTags("solo", 1).map(({ tag }) => tag)).toEqual([
      "solo",
    ]);
    expect(repository.searchTags("solo", 20).map(({ tag }) => tag)).toEqual(
      expected,
    );
    database.close();
  });

  test("keeps canonical aliases searchable", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    expect(repository.searchTags("female solo", 1)).toEqual([
      expect.objectContaining({
        tag: "solo",
        aliases: ["female solo", "solo female"],
      }),
    ]);
    database.close();
  });

  test("searches and combines tag category text with tag names", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    expect(repository.searchTags("artist", 20).map(({ tag }) => tag)).toEqual([
      "@solokitsune",
    ]);
    expect(repository.searchTags("artist solok", 1)).toEqual([
      expect.objectContaining({
        tag: "@solokitsune",
        category: "artist",
      }),
    ]);

    database.sqlite.exec("DROP TABLE tag_search");
    expect(repository.searchTags("artist", 1)).toEqual([
      expect.objectContaining({ tag: "@solokitsune" }),
    ]);
    database.close();
  });

  test("returns escaped prompt text for tags with literal parentheses", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    expect(repository.searchTags("wishiwashi", 1)).toEqual([
      expect.objectContaining({
        tag: "wishiwashi (solo)",
        insertText: "wishiwashi \\(solo\\)",
      }),
    ]);
    database.close();
  });

  test("pins an exact tag before stronger contextual prefix matches", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    expect(
      repository
        .searchTags("solo", 3, ["1girl"])
        .map(({ tag, cooccurrenceCount }) => ({ tag, cooccurrenceCount })),
    ).toEqual([
      { tag: "solo", cooccurrenceCount: 100 },
      { tag: "solosis", cooccurrenceCount: 2_000 },
      { tag: "solo focus", cooccurrenceCount: 1_000 },
    ]);
    database.close();
  });

  test("keeps prompt tags in autocomplete results for the UI to mark", async () => {
    const files = await fixture();
    const database = createDatabase(files);
    const repository = new StudioRepository(database);
    replaceAutocompleteRankingFixture(repository);

    expect(repository.searchTags("solo", 3, ["solo"])).toContainEqual(
      expect.objectContaining({ tag: "solo" }),
    );
    database.close();
  });
});
