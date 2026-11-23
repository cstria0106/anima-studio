import {
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  assertSafeRelativePath,
  type EngineArtifact,
} from "@anima/runtime";

export interface ArchiveExtractOptions {
  /** Receives the extracted fraction (0-1) when the archive tool reports it. */
  onProgress?(fraction: number): void;
}

export interface ArchiveExtractor {
  extract(
    artifact: EngineArtifact,
    archivePath: string,
    releaseRoot: string,
    options?: ArchiveExtractOptions,
  ): Promise<void>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  /** Receives stdout text as the command writes it. */
  onStdout?(text: string): void;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
}

async function readText(
  stream: ReadableStream<Uint8Array>,
  onText?: (text: string) => void,
): Promise<string> {
  if (!onText) return new Response(stream).text();
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const part = decoder.decode(chunk.value, { stream: true });
    text += part;
    if (part) onText(part);
  }
  const rest = decoder.decode();
  text += rest;
  if (rest) onText(rest);
  return text;
}

export class BunCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options: CommandRunOptions = {},
  ): Promise<CommandResult> {
    const child = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      readText(child.stdout, options.onStdout),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  }
}

/**
 * Reads the percentages from 7-Zip's `-bsp1` progress output. 7-Zip redraws
 * one status line in place, separating redraws with carriage returns or
 * backspaces, and each redraw starts with the percentage: `  37% 120 - path`.
 * The same percentage can be reported more than once.
 */
export class SevenZipProgressParser {
  private pending = "";

  constructor(private readonly onPercent: (percent: number) => void) {}

  push(text: string): void {
    const segments = `${this.pending}${text}`.split(/[\r\n\b]/);
    this.pending = segments.pop() ?? "";
    for (const segment of segments) this.read(segment);
    // A segment only reaches `%` after all of its digits have arrived, so the
    // unfinished tail can be read now instead of waiting for the next redraw.
    this.read(this.pending);
  }

  private read(segment: string): void {
    const match = /^\s*(\d{1,3})%/.exec(segment);
    if (!match?.[1]) return;
    const percent = Number(match[1]);
    if (percent <= 100) this.onPercent(percent);
  }
}

function validateArchiveEntries(
  output: string,
  stripComponents: number,
): void {
  const entries = output.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) {
    throw new Error("Archive contains no entries.");
  }
  for (const rawEntry of entries) {
    const entry = rawEntry.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!entry) continue;
    if (
      entry.startsWith("/") ||
      /^[a-z]:/i.test(entry) ||
      entry.includes("\0")
    ) {
      throw new Error(`Archive contains an unsafe path: ${rawEntry}`);
    }
    const segments = entry.split("/").filter((part) => part !== ".");
    if (segments.includes("..")) {
      throw new Error(`Archive contains an unsafe path: ${rawEntry}`);
    }
    const stripped = segments.slice(stripComponents).join("/");
    if (stripped) assertSafeRelativePath(stripped, "archive entry");
  }
}

async function assertLinksStayInside(
  directory: string,
  root = directory,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      const target = await realpath(path);
      const relativeTarget = relative(root, target);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${sep}`) ||
        isAbsolute(relativeTarget)
      ) {
        throw new Error(`Archive link escapes the release root: ${path}`);
      }
    } else if (metadata.isDirectory()) {
      await assertLinksStayInside(path, root);
    }
  }
}

export class TarArchiveExtractor implements ArchiveExtractor {
  constructor(
    private readonly runner: CommandRunner = new BunCommandRunner(),
    private readonly command = process.platform === "win32" ? "tar.exe" : "tar",
  ) {}

  async extract(
    artifact: EngineArtifact,
    archivePath: string,
    releaseRoot: string,
    options: ArchiveExtractOptions = {},
  ): Promise<void> {
    const destination = resolve(releaseRoot, artifact.destination);
    const relativeDestination = relative(resolve(releaseRoot), destination);
    if (
      relativeDestination === ".." ||
      relativeDestination.startsWith(`..${sep}`) ||
      isAbsolute(relativeDestination)
    ) {
      throw new Error(`${artifact.id} destination escapes the release root.`);
    }

    if (artifact.archive.format === "raw") {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(archivePath, destination, constants.COPYFILE_EXCL);
      return;
    }

    if (artifact.archive.format === "7z") {
      await this.extract7z(
        artifact,
        archivePath,
        releaseRoot,
        destination,
        options,
      );
      return;
    }

    const listing = await this.runner.run(this.command, ["-tf", archivePath]);
    if (listing.exitCode !== 0) {
      throw new Error(
        `Could not inspect ${artifact.id} archive: ${listing.stderr.trim()}`,
      );
    }
    validateArchiveEntries(
      listing.stdout,
      artifact.archive.stripComponents,
    );

    await mkdir(destination, { recursive: true });
    const args = [
      "-xf",
      archivePath,
      "--strip-components",
      String(artifact.archive.stripComponents),
      "-C",
      destination,
    ];
    const extracted = await this.runner.run(this.command, args);
    if (extracted.exitCode !== 0) {
      throw new Error(
        `Could not extract ${artifact.id}: ${extracted.stderr.trim()}`,
      );
    }
    await assertLinksStayInside(destination, releaseRoot);
  }

  private async extract7z(
    artifact: EngineArtifact,
    archivePath: string,
    releaseRoot: string,
    destination: string,
    options: ArchiveExtractOptions,
  ): Promise<void> {
    const sevenZip = join(releaseRoot, "_managed", "tools", "7zr.exe");
    const listing = await this.runner.run(sevenZip, ["l", "-slt", archivePath]);
    if (listing.exitCode !== 0) {
      throw new Error(
        `Could not inspect ${artifact.id} archive: ${listing.stderr.trim()}`,
      );
    }
    const separator = listing.stdout.indexOf("----------");
    const paths = (separator >= 0 ? listing.stdout.slice(separator) : "")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^Path = (.+)$/);
        return match?.[1] ? [match[1]] : [];
      })
      .join("\n");
    validateArchiveEntries(paths, artifact.archive.stripComponents);

    if (artifact.archive.stripComponents !== 1) {
      throw new Error("Managed 7z extraction currently requires one root folder.");
    }
    const scratch = join(
      releaseRoot,
      `.extract-${artifact.id}-${crypto.randomUUID()}`,
    );
    await mkdir(scratch, { recursive: false });
    let reportedPercent = -1;
    const progress = new SevenZipProgressParser((percent) => {
      if (percent <= reportedPercent) return;
      reportedPercent = percent;
      options.onProgress?.(percent / 100);
    });
    try {
      // 7-Zip hides progress when stdout is not a terminal unless -bsp1 asks
      // for it, which would leave a multi-gigabyte unpack looking frozen.
      const extracted = await this.runner.run(
        sevenZip,
        ["x", "-y", "-bsp1", `-o${scratch}`, archivePath],
        { onStdout: (text) => progress.push(text) },
      );
      if (extracted.exitCode !== 0) {
        throw new Error(
          `Could not extract ${artifact.id}: ${extracted.stderr.trim()}`,
        );
      }
      const roots = await readdir(scratch, { withFileTypes: true });
      if (roots.length !== 1 || !roots[0]?.isDirectory()) {
        throw new Error(`${artifact.id} archive has an unexpected root layout.`);
      }
      const strippedRoot = join(scratch, roots[0].name);
      await mkdir(destination, { recursive: true });
      for (const entry of await readdir(strippedRoot)) {
        await rename(join(strippedRoot, entry), join(destination, entry));
      }
      await assertLinksStayInside(destination, releaseRoot);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
