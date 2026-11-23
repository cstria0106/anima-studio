import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EngineArtifact } from "@anima/runtime";

import {
  BunCommandRunner,
  type CommandResult,
  type CommandRunOptions,
  type CommandRunner,
  SevenZipProgressParser,
  TarArchiveExtractor,
} from "./extract";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function percentsFrom(chunks: string[]): number[] {
  const percents: number[] = [];
  const parser = new SevenZipProgressParser((percent) => percents.push(percent));
  for (const chunk of chunks) parser.push(chunk);
  return percents;
}

describe("7-Zip progress parser", () => {
  test("reads in-place redraws separated by carriage returns", () => {
    expect(
      percentsFrom([
        "  0%\r    \r",
        " 12% 3 - root\\a.bin\r",
        "                    \r 57% 9 - root\\b.bin",
      ]),
    ).toEqual([0, 12, 57]);
  });

  test("reads redraws separated by backspaces", () => {
    const erase = "\b".repeat(4) + " ".repeat(4) + "\b".repeat(4);
    expect(percentsFrom([`  3%${erase} 41%${erase}100%`])).toEqual([
      3, 41, 100,
    ]);
  });

  test("waits for digits split across chunks", () => {
    expect(percentsFrom(["\r 4", "5% 9 - root\\c.bin\r"])).toEqual([45]);
  });

  test("ignores percentages inside file names", () => {
    expect(percentsFrom(["\r 20% 1 - root\\save 50%.png\r"])).toEqual([20]);
  });
});

describe("Bun command runner", () => {
  test("streams stdout while still returning the full output", async () => {
    const streamed: string[] = [];
    const result = await new BunCommandRunner().run(
      process.execPath,
      ["-e", 'process.stdout.write(" 10%\\r"); process.stdout.write(" 90%\\r");'],
      { onStdout: (text) => streamed.push(text) },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(" 10%\r 90%\r");
    expect(streamed.join("")).toBe(result.stdout);
  });
});

function sevenZipArtifact(): EngineArtifact {
  return {
    id: "engine",
    kind: "engine",
    name: "Engine",
    version: "1.0.0",
    revision: "a".repeat(40),
    downloadUrl: "https://example.test/engine.7z",
    sourceUrl: `https://example.test/source/${"a".repeat(40)}`,
    bytes: 3,
    sha256: "0".repeat(64),
    license: "MIT",
    archive: { format: "7z", stripComponents: 1 },
    destination: ".",
  };
}

class FakeSevenZip implements CommandRunner {
  readonly calls: string[][] = [];

  constructor(private readonly progressChunks: string[]) {}

  async run(
    _command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    this.calls.push(args);
    if (args[0] === "l") {
      return {
        exitCode: 0,
        stdout:
          "Path = engine.7z\nType = 7z\n\n----------\n" +
          "Path = root\nFolder = +\n\nPath = root\\main.py\nFolder = -\n",
        stderr: "",
      };
    }
    const scratch = args.find((arg) => arg.startsWith("-o"))!.slice(2);
    await mkdir(join(scratch, "root"), { recursive: true });
    await writeFile(join(scratch, "root", "main.py"), "print()");
    for (const chunk of this.progressChunks) options?.onStdout?.(chunk);
    return { exitCode: 0, stdout: this.progressChunks.join(""), stderr: "" };
  }
}

describe("7z archive extraction", () => {
  test("asks 7-Zip for progress and reports each new percentage once", async () => {
    const releaseRoot = await mkdtemp(join(tmpdir(), "anima-extract-test-"));
    temporaryDirectories.push(releaseRoot);
    const runner = new FakeSevenZip([
      "\r  0%",
      "\r 37% 120 - root\\main.py",
      "\r 37% 121 - root\\main.py",
      "\r100%\r",
    ]);
    const fractions: number[] = [];

    await new TarArchiveExtractor(runner).extract(
      sevenZipArtifact(),
      "engine.7z",
      releaseRoot,
      { onProgress: (fraction) => fractions.push(fraction) },
    );

    expect(runner.calls[1]).toContain("-bsp1");
    expect(fractions).toEqual([0, 0.37, 1]);
    expect(await readFile(join(releaseRoot, "main.py"), "utf8")).toBe(
      "print()",
    );
  });
});
