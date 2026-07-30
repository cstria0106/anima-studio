import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
} from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { parseCsvRow } from "../src/index";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = resolve(packageRoot, "data");
const minimumCooccurrence = 5_000;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}

async function lineCount(path: string): Promise<number> {
  const lines = createInterface({ input: createReadStream(path) });
  let count = -1;
  for await (const _line of lines) count += 1;
  return Math.max(count, 0);
}

async function writePortableCooccurrences(
  sourcePath: string,
  destinationPath: string,
): Promise<number> {
  const lines = createInterface({ input: createReadStream(sourcePath) });
  const output = createWriteStream(destinationPath, { encoding: "utf8" });
  output.write("tag_a,tag_b,count\n");
  let first = true;
  let count = 0;

  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const fields = parseCsvRow(line);
    const value = Number(fields[2]);
    if (!Number.isFinite(value) || value < minimumCooccurrence) continue;
    if (!output.write(`${line}\n`)) await once(output, "drain");
    count += 1;
  }

  output.end();
  await once(output, "finish");
  return count;
}

const tagsSource = argument("--tags");
const cooccurrenceSource = argument("--cooccurrence");
if (!tagsSource || !cooccurrenceSource) {
  throw new Error(
    "Usage: bun run data:build -- --tags <danbooru_tags.csv> " +
      "--cooccurrence <danbooru_tags_cooccurrence.csv>",
  );
}

for (const source of [tagsSource, cooccurrenceSource]) {
  if (!existsSync(source)) throw new Error(`Source CSV not found: ${source}`);
}

await mkdir(outputDirectory, { recursive: true });
const tagsDestination = resolve(outputDirectory, "danbooru_tags.csv");
const cooccurrenceDestination = resolve(
  outputDirectory,
  "danbooru_tags_cooccurrence.csv",
);
await copyFile(tagsSource, tagsDestination);
const cooccurrenceRows = await writePortableCooccurrences(
  cooccurrenceSource,
  cooccurrenceDestination,
);
const tagRows = await lineCount(tagsDestination);

const manifest = {
  version: 1,
  normalization: "danbooru-underscores-to-spaces-v1",
  source: "comfyui-autocomplete-plus",
  tags: {
    file: basename(tagsDestination),
    rows: tagRows,
    sha256: await sha256(tagsDestination),
  },
  cooccurrences: {
    file: basename(cooccurrenceDestination),
    rows: cooccurrenceRows,
    minimumCount: minimumCooccurrence,
    sha256: await sha256(cooccurrenceDestination),
    sourceSha256: await sha256(cooccurrenceSource),
  },
};
await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Wrote ${tagRows.toLocaleString()} tags and ` +
    `${cooccurrenceRows.toLocaleString()} cooccurrences to ` +
    `${dirname(tagsDestination)}.`,
);
