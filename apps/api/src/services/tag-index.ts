import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  OFFLINE_TAGS,
  parseCsvRow,
  parseDanbooruCooccurrenceRow,
  parseDanbooruTagRow,
  type OfflineTag,
  type OfflineTagCooccurrence,
} from "@anima/tag-data";
import type {
  StudioRepository,
  TagIndexMetadata,
  TagIndexStats,
} from "../db/repository";

const importFormatVersion = 1;
const fallbackFingerprint = "fallback-tags-v1";

export interface TagDataSource {
  tagsCsvPath: string;
  cooccurrenceCsvPath: string;
  manifestPath: string;
  minimumCooccurrenceCount: number;
}

export interface TagIndexInitialization {
  imported: boolean;
  metadata: TagIndexMetadata;
  stats: TagIndexStats;
}

async function sourceFingerprint(source: TagDataSource): Promise<string> {
  const [tagsStat, cooccurrenceStat, manifest] = await Promise.all([
    stat(source.tagsCsvPath),
    stat(source.cooccurrenceCsvPath),
    readFile(source.manifestPath, "utf8").catch(() => ""),
  ]);
  const identity = JSON.stringify({
    importFormatVersion,
    tags: {
      path: source.tagsCsvPath,
      bytes: tagsStat.size,
      modified: tagsStat.mtimeMs,
    },
    cooccurrences: {
      path: source.cooccurrenceCsvPath,
      bytes: cooccurrenceStat.size,
      modified: cooccurrenceStat.mtimeMs,
      minimumCount: source.minimumCooccurrenceCount,
    },
    manifest,
  });
  return createHash("sha256").update(identity).digest("hex");
}

async function readRows(
  path: string,
  expectedHeader: readonly string[],
  visit: (fields: string[]) => void,
): Promise<void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let first = true;
  try {
    for await (const line of lines) {
      if (first) {
        first = false;
        const header = parseCsvRow(line.replace(/^\uFEFF/, ""));
        if (
          expectedHeader.some(
            (field, index) => header[index]?.trim() !== field,
          )
        ) {
          throw new Error(
            `Unsupported CSV header in ${path}; expected ${expectedHeader.join(",")}.`,
          );
        }
        continue;
      }
      if (!line.trim()) continue;
      visit(parseCsvRow(line));
    }
  } finally {
    lines.close();
    if (!input.closed) {
      input.destroy();
      await once(input, "close");
    }
  }
  if (first) throw new Error(`CSV file is empty: ${path}`);
}

export async function readDanbooruTagData(source: TagDataSource): Promise<{
  tags: OfflineTag[];
  cooccurrences: OfflineTagCooccurrence[];
}> {
  const tags: OfflineTag[] = [];
  await readRows(
    source.tagsCsvPath,
    ["tag", "category", "count", "alias"],
    (fields) => {
      const value = parseDanbooruTagRow(fields);
      if (value) tags.push(value);
    },
  );

  const cooccurrences: OfflineTagCooccurrence[] = [];
  await readRows(
    source.cooccurrenceCsvPath,
    ["tag_a", "tag_b", "count"],
    (fields) => {
      const value = parseDanbooruCooccurrenceRow(fields);
      if (value && value.count >= source.minimumCooccurrenceCount) {
        cooccurrences.push(value);
      }
    },
  );
  return { tags, cooccurrences };
}

function currentIndex(
  repository: StudioRepository,
  fingerprint: string,
): TagIndexMetadata | null {
  const metadata = repository.tagIndexMetadata();
  if (!metadata || metadata.fingerprint !== fingerprint) return null;
  const counts = repository.tagIndexCounts();
  return counts.tagCount === metadata.tagCount &&
    counts.cooccurrenceCount === metadata.cooccurrenceCount
    ? metadata
    : null;
}

export async function initializeDanbooruTagIndex(
  repository: StudioRepository,
  source: TagDataSource,
): Promise<TagIndexInitialization> {
  const fingerprint = await sourceFingerprint(source);
  const current = currentIndex(repository, fingerprint);
  if (current) {
    return {
      imported: false,
      metadata: current,
      stats: {
        tagCount: current.tagCount,
        cooccurrenceCount: current.cooccurrenceCount,
        skippedCooccurrences: 0,
      },
    };
  }

  const dataset = await readDanbooruTagData(source);
  const stats = repository.replaceTagIndex(
    dataset.tags,
    dataset.cooccurrences,
    {
      fingerprint,
      source: "danbooru",
      minimumCooccurrenceCount: source.minimumCooccurrenceCount,
    },
  );
  return {
    imported: true,
    metadata: repository.tagIndexMetadata()!,
    stats,
  };
}

export function initializeFallbackTagIndex(
  repository: StudioRepository,
): TagIndexInitialization {
  const current = currentIndex(repository, fallbackFingerprint);
  if (current) {
    return {
      imported: false,
      metadata: current,
      stats: {
        tagCount: current.tagCount,
        cooccurrenceCount: current.cooccurrenceCount,
        skippedCooccurrences: 0,
      },
    };
  }
  const stats = repository.replaceTagIndex(OFFLINE_TAGS, [], {
    fingerprint: fallbackFingerprint,
    source: "fallback",
    minimumCooccurrenceCount: null,
  });
  return {
    imported: true,
    metadata: repository.tagIndexMetadata()!,
    stats,
  };
}
