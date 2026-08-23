import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { InstanceCoordinator } from "./instance";
import type { ObservedWindowsProcess, WindowsProcessInspector } from "../process/windows";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class FakeInspector implements WindowsProcessInspector {
  constructor(private readonly values: Map<number, ObservedWindowsProcess | null>) {}
  observe(pid: number) { return Promise.resolve(this.values.get(pid) ?? null); }
  terminateTree() { return Promise.resolve(); }
}

function observed(pid: number, executable: string, startedAt: string): ObservedWindowsProcess {
  return { pid, executable, startedAt, commandLine: executable };
}

async function appData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anima-instance-"));
  cleanup.push(root);
  const data = join(root, "data");
  await mkdir(join(data, "_app"), { recursive: true });
  return data;
}

describe("portable instance coordination", () => {
  test("only one concurrent process acquires the atomic lock", async () => {
    const data = await appData();
    const start = "2026-08-01T00:00:00.000Z";
    const inspector = new FakeInspector(new Map([
      [100, observed(100, "C:\\A\\AnimaStudio.exe", start)],
      [200, observed(200, "C:\\A\\AnimaStudio.exe", start)],
    ]));
    const first = await new InstanceCoordinator(data, {
      inspector, pid: 100, executablePath: "C:\\A\\AnimaStudio.exe",
    }).acquire();
    expect(first.owner).toBeTrue();
    await expect(new InstanceCoordinator(data, {
      inspector, pid: 200, executablePath: "C:\\A\\AnimaStudio.exe",
      startupWaitMs: 1, pollMs: 1,
    }).acquire()).rejects.toThrow(/owns this data folder/);
    if (first.owner) await first.lease.release();
  });

  test("a second launch validates the token endpoint and reuses the dynamic URL", async () => {
    const data = await appData();
    const start = "2026-08-01T00:00:00.000Z";
    const executable = "C:\\공백 경로\\AnimaStudio.exe";
    const inspector = new FakeInspector(new Map([
      [100, observed(100, executable, start)],
      [200, observed(200, executable, start)],
    ]));
    const first = await new InstanceCoordinator(data, { inspector, pid: 100, executablePath: executable }).acquire();
    if (!first.owner) throw new Error("first process did not acquire");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => new Response(
        request.headers.get("X-Anima-Instance-Token") === first.lease.token ? "ok" : "no",
        { status: request.headers.get("X-Anima-Instance-Token") === first.lease.token ? 200 : 404 },
      ),
    });
    if (!server.port) throw new Error("test server has no port");
    const port = server.port;
    await first.lease.publish("127.0.0.1", port);
    try {
      const second = await new InstanceCoordinator(data, { inspector, pid: 200, executablePath: executable }).acquire();
      expect(second).toEqual({ owner: false, url: `http://127.0.0.1:${port}` });
    } finally {
      await server.stop(true);
      await first.lease.release();
    }
  });

  test("stores a wildcard bind host but probes and reuses it through loopback", async () => {
    const data = await appData();
    const start = "2026-08-01T00:00:00.000Z";
    const executable = "C:\\A\\AnimaStudio.exe";
    const inspector = new FakeInspector(new Map([
      [100, observed(100, executable, start)],
      [200, observed(200, executable, start)],
    ]));
    const first = await new InstanceCoordinator(data, {
      inspector,
      pid: 100,
      executablePath: executable,
    }).acquire();
    if (!first.owner) throw new Error("first process did not acquire");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => new Response(
        request.headers.get("X-Anima-Instance-Token") === first.lease.token
          ? "ok"
          : "no",
        {
          status:
            request.headers.get("X-Anima-Instance-Token") === first.lease.token
              ? 200
              : 404,
        },
      ),
    });
    await first.lease.publish("0.0.0.0", server.port!);
    expect(JSON.parse(await readFile(join(data, "_app", "instance.json"), "utf8")))
      .toMatchObject({ host: "0.0.0.0", port: server.port });
    try {
      const second = await new InstanceCoordinator(data, {
        inspector,
        pid: 200,
        executablePath: executable,
      }).acquire();
      expect(second).toEqual({
        owner: false,
        url: `http://127.0.0.1:${server.port}`,
      });
    } finally {
      await server.stop(true);
      await first.lease.release();
    }
  });

  for (const [name, actual] of [
    ["missing process", null],
    ["PID reuse/start mismatch", observed(10, "C:\\A\\AnimaStudio.exe", "2026-08-02T00:00:00Z")],
    ["EXE mismatch", observed(10, "C:\\Other\\AnimaStudio.exe", "2026-08-01T00:00:00Z")],
  ] as const) {
    test(`recovers a stale lock for ${name}`, async () => {
      const data = await appData();
      const token = "a".repeat(64);
      const stale = { pid: 10, executable: "C:\\A\\AnimaStudio.exe", startedAt: "2026-08-01T00:00:00Z", token };
      await writeFile(join(data, "_app", "instance.lock"), JSON.stringify(stale));
      await writeFile(join(data, "_app", "instance.json"), JSON.stringify({
        ...stale,
        host: "127.0.0.1",
        port: 12345,
      }));
      const self = observed(100, "C:\\A\\AnimaStudio.exe", "2026-08-03T00:00:00Z");
      const inspector = new FakeInspector(new Map([[10, actual], [100, self]]));
      const acquired = await new InstanceCoordinator(data, {
        inspector, pid: 100, executablePath: self.executable,
      }).acquire();
      expect(acquired.owner).toBeTrue();
      if (acquired.owner) {
        expect(JSON.parse(await readFile(join(data, "_app", "instance.lock"), "utf8")).token)
          .toBe(acquired.lease.token);
        await acquired.lease.release();
      }
    });
  }
});
