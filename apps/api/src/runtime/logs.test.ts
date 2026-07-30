import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { redactRuntimeLog, RuntimeLogService } from "./logs";

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
