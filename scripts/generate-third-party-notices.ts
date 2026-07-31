import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = join(root, "THIRD_PARTY_NOTICES.md");
const licenseNames = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
] as const;

interface Notice {
  name: string;
  version: string;
  license: string;
  text: string;
}

async function packageDirectories(nodeModules: string): Promise<string[]> {
  const entries = await readdir(nodeModules, { withFileTypes: true }).catch(() => []);
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".bun" || entry.name === ".cache") continue;
    const path = join(nodeModules, entry.name);
    const directory = entry.isDirectory() ||
      (entry.isSymbolicLink() && await stat(path).then((value) => value.isDirectory()).catch(() => false));
    if (!directory) continue;
    if (entry.name.startsWith("@")) {
      for (const child of await readdir(path, { withFileTypes: true }).catch(() => [])) {
        const childPath = join(path, child.name);
        if (
          child.isDirectory() ||
          (child.isSymbolicLink() && await stat(childPath).then((value) => value.isDirectory()).catch(() => false))
        ) result.push(childPath);
      }
    } else {
      result.push(path);
    }
  }
  return result;
}

async function noticeFor(directory: string): Promise<Notice | null> {
  try {
    const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
      license?: string;
      private?: boolean;
    };
    if (!pkg.name || !pkg.version || pkg.private) return null;
    let text = "License text was not included by the package.";
    for (const filename of licenseNames) {
      const path = join(directory, filename);
      if (await stat(path).then((value) => value.isFile()).catch(() => false)) {
        text = (await readFile(path, "utf8")).trim();
        break;
      }
    }
    return {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "UNKNOWN",
      text,
    };
  } catch {
    return null;
  }
}

const roots = [
  join(root, "node_modules"),
  join(root, "apps", "api", "node_modules"),
  join(root, "apps", "web", "node_modules"),
];
const bunStore = join(root, "node_modules", ".bun");
const storeRoots = (await readdir(bunStore, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(bunStore, entry.name, "node_modules"));
const directories = (
  await Promise.all([...roots, ...storeRoots].map(packageDirectories))
).flat();
const notices = (await Promise.all(directories.map(noticeFor)))
  .filter((value): value is Notice => value !== null)
  .filter(
    (value, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.name === value.name && candidate.version === value.version,
      ) === index,
  )
  .sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );

const sections = notices.map(
  (notice) =>
    `## ${notice.name}@${notice.version}\n\nDeclared license: ${notice.license}\n\n\`\`\`text\n${notice.text}\n\`\`\``,
);
const document = [
  "# Third-Party Notices",
  "",
  "Anima Studio includes the Bun runtime and the npm packages listed below.",
  "Bun is Copyright (c) 2021-present Jarred Sumner and contributors and is distributed under the MIT License.",
  "Package license files are reproduced from the installed dependency tree at build time.",
  "",
  ...sections,
  "",
].join("\n");
await writeFile(output, document, "utf8");
console.log(`Generated ${basename(output)} with ${notices.length} package notices.`);
