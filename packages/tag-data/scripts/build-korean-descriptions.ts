import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  normalizeDanbooruTag,
  parseCsvRecords,
  parseDanbooruTagRow,
  type OfflineTag,
} from "../src/index";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const dataDirectory = resolve(packageRoot, "data");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function uniqueTarget(
  values: Map<string, Set<string>>,
  key: string,
): string | null {
  const targets = values.get(key);
  return targets?.size === 1 ? [...targets][0]! : null;
}

function addTarget(
  values: Map<string, Set<string>>,
  key: string,
  target: string,
): void {
  const targets = values.get(key) ?? new Set<string>();
  targets.add(target);
  values.set(key, targets);
}

const descriptionsSource = argument("--descriptions");
if (!descriptionsSource) {
  throw new Error(
    "Usage: bun run data:build-ko -- --descriptions <Korean CSV> [--tags <Anima CSV>]",
  );
}

const tagsPath = resolve(argument("--tags") ?? resolve(dataDirectory, "danbooru_tags.csv"));
const descriptionsPath = resolve(descriptionsSource);
const outputPath = resolve(dataDirectory, "danbooru_tags_ko.csv");
const manifestPath = resolve(dataDirectory, "manifest.json");

const tagRows = parseCsvRecords(await Bun.file(tagsPath).text());
if (tagRows[0]?.[0] === "tag") tagRows.shift();

const tags: OfflineTag[] = [];
const canonical = new Map<string, OfflineTag>();
const artists = new Map<string, Set<string>>();
const aliases = new Map<string, Set<string>>();
for (const fields of tagRows) {
  const tag = parseDanbooruTagRow(fields);
  if (!tag) continue;
  tags.push(tag);
  const key = normalizeDanbooruTag(tag.tag).toLowerCase();
  canonical.set(key, tag);
  if (tag.category === "artist" && key.startsWith("@")) {
    addTarget(artists, key.slice(1), tag.tag);
  }
  for (const alias of tag.aliases ?? []) {
    addTarget(
      aliases,
      normalizeDanbooruTag(alias).toLowerCase(),
      tag.tag,
    );
  }
}

const sourceRows = parseCsvRecords(await Bun.file(descriptionsPath).text());
if (sourceRows[0]?.[0] === "tag") sourceRows.shift();

type Match = { description: string; priority: number; count: number };
const matches = new Map<string, Match>();
const stats = { canonical: 0, artist: 0, alias: 0, unmatched: 0, empty: 0 };
for (const fields of sourceRows) {
  const sourceTag = fields[0]?.trim() ?? "";
  const description = (fields[3] ?? "").trim().replace(/\s+/g, " ");
  if (!sourceTag || !description) {
    stats.empty += 1;
    continue;
  }
  const key = normalizeDanbooruTag(sourceTag).toLowerCase();
  let target: string | null = canonical.get(key)?.tag ?? null;
  let priority = 3;
  if (target) {
    stats.canonical += 1;
  } else {
    target = uniqueTarget(artists, key);
    priority = 2;
    if (target) {
      stats.artist += 1;
    } else {
      target = uniqueTarget(aliases, key);
      priority = 1;
      if (target) stats.alias += 1;
    }
  }
  if (!target) {
    stats.unmatched += 1;
    continue;
  }
  const count = Number.parseInt(fields[2] ?? "", 10) || 0;
  const current = matches.get(target);
  if (
    !current ||
    priority > current.priority ||
    (priority === current.priority && count > current.count)
  ) {
    matches.set(target, { description, priority, count });
  }
}

const output = ["tag,description"];
for (const tag of tags) {
  const match = matches.get(tag.tag);
  if (match) output.push(`${csv(tag.tag)},${csv(match.description)}`);
}
await Bun.write(outputPath, `${output.join("\n")}\n`);

const bytes = await Bun.file(outputPath).arrayBuffer();
const manifest = JSON.parse(await Bun.file(manifestPath).text()) as Record<string, unknown>;
manifest.descriptions = {
  file: "danbooru_tags_ko.csv",
  rows: matches.size,
  sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
  sourceRows: sourceRows.length,
  matchedRows: stats.canonical + stats.artist + stats.alias,
  ...stats,
};
await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Wrote ${matches.size.toLocaleString()} Korean descriptions ` +
    `(${stats.canonical.toLocaleString()} canonical, ` +
    `${stats.artist.toLocaleString()} artist, ${stats.alias.toLocaleString()} alias).`,
);
