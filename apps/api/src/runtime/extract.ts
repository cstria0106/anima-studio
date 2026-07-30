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

export interface ArchiveExtractor {
  extract(
    artifact: EngineArtifact,
    archivePath: string,
    releaseRoot: string,
  ): Promise<void>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(command: string, args: string[]): Promise<CommandResult> {
    const child = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
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
      await this.extract7z(artifact, archivePath, releaseRoot, destination);
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
    try {
      const extracted = await this.runner.run(sevenZip, [
        "x",
        "-y",
        `-o${scratch}`,
        archivePath,
      ]);
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
