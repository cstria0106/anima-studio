import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  redactRuntimeLog,
  RuntimeLogService,
  sanitizeRuntimeLog,
} from "./logs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("runtime logs", () => {
  test("redacts authorization, token fields, query values and known secrets", () => {
    expect(
      redactRuntimeLog(
        'Authorization: Bearer abc123 "token":"secret-token" https://x.test?a=1&api_key=value known-secret',
        ["known-secret"],
      ),
    ).toBe(
      'Authorization: [REDACTED] "token":"[REDACTED]" https://x.test?a=1&api_key=[REDACTED] [REDACTED]',
    );
  });

  test("removes ANSI, OSC, VT and orphan control bytes as readable text", () => {
    expect(
      sanitizeRuntimeLog(
        "\u001b[32m[INFO]\u001b[0m " +
          "\u001b]8;;https://example.test\u0007linked\u001b]8;;\u0007 " +
          "\u001bPignored\u001b\\ready\u001b\u0000",
      ),
    ).toBe("[INFO] linked ready");
  });

  test("sanitizes before redacting storage and live events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anima-log-ansi-test-"));
    temporaryDirectories.push(directory);
    const logs = new RuntimeLogService({ directory });
    logs.addSecret("secret-token");
    const events: string[] = [];
    const subscription = logs.subscribe((event) => events.push(event.line));

    await logs.append(
      "session-1",
      "stdout",
      "\u001b[32m[INFO]\u001b[0m sec\u001b[31mret-\u001b]0;title\u0007token",
    );
    await logs.flush();
    subscription.close();

    expect(events).toEqual(["[INFO] [REDACTED]"]);
    const stored = await readFile(join(directory, "session-1.log"), "utf8");
    expect(stored).toContain("[INFO] [REDACTED]");
    expect(stored).not.toContain("\u001b");
    expect(stored).not.toContain("secret-token");
    expect(await logs.readTail("session-1")).toBe(stored);
  });

  test("sanitizes and redacts historical log tails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "anima-log-historical-ansi-test-"),
    );
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, "legacy.log"),
      "2026-07-30T00:00:00.000Z [stdout] \u001b[32m[INFO]\u001b[0m sec\u001b[31mret-token\u001b\n",
    );
    const logs = new RuntimeLogService({ directory });
    logs.addSecret("secret-token");

    const tail = await logs.readTail("legacy");

    expect(tail).toContain("[INFO] [REDACTED]");
    expect(tail).not.toContain("\u001b");
    expect(tail).not.toContain("secret-token");
  });

  test("rotates bounded session files and exposes live tail events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anima-logs-test-"));
    temporaryDirectories.push(directory);
    const logs = new RuntimeLogService({
      directory,
      maxFileBytes: 90,
      retainedFiles: 3,
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    const events: string[] = [];
    const subscription = logs.subscribe((event) => events.push(event.line));

    await logs.append("session-1", "stdout", "first line");
    await logs.append("session-1", "stderr", "second line");
    await logs.append("session-1", "supervisor", "third line");
    await logs.flush();
    subscription.close();

    expect((await readdir(directory)).length).toBeGreaterThan(1);
    expect(await logs.readTail("session-1")).toContain("third line");
    expect(events).toEqual(["first line", "second line", "third line"]);
  });

  test("keeps SSE cursors increasing across API process restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anima-log-cursor-test-"));
    temporaryDirectories.push(directory);
    const first = new RuntimeLogService({
      directory,
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    const firstEvent = await first.append(
      "session-1",
      "stdout",
      "before restart",
    );
    await first.flush();

    const second = new RuntimeLogService({
      directory,
      now: () => new Date("2026-07-30T00:00:01.000Z"),
    });
    const secondEvent = await second.append(
      "session-2",
      "stdout",
      "after restart",
    );

    expect(secondEvent.cursor).toBeGreaterThan(firstEvent.cursor);
  });
});
