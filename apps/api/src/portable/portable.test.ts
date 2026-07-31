import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { portableDataDirectory, assertPortableDataWritable } from "./paths";
import { extractEmbeddedResources, type EmbeddedResource } from "./resources";
import { EmbeddedStaticSite } from "./static";

const temporaryDirectories: string[] = [];

async function temporary(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), name));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function embedded(path: string, text: string): EmbeddedResource {
  const bytes = Buffer.from(text);
  return {
    path,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    blob: new Blob([bytes]),
  };
}

describe("portable paths", () => {
  test("uses data beside an executable in a path containing spaces and Korean", () => {
    expect(portableDataDirectory("C:\\그림 작업\\Anima Studio\\AnimaStudio.exe"))
      .toBe("C:\\그림 작업\\Anima Studio\\data");
  });

  test("reports an unwritable portable location without a LocalAppData fallback", async () => {
    const root = await temporary("anima-unwritable-");
    const blockingFile = join(root, "blocked");
    await writeFile(blockingFile, "file");
    await expect(assertPortableDataWritable(blockingFile)).rejects.toThrow(
      /C:\\AnimaStudio.*LocalAppData/s,
    );
  });
});

describe("embedded resources", () => {
  test("extracts, reuses, and repairs hash-invalid content", async () => {
    const data = await temporary("anima-resources-");
    const resources = [
      embedded("migrations/0000.sql", "SELECT 1;"),
      embedded("tag-data/manifest.json", '{"ok":true}'),
    ];
    const hash = createHash("sha256").update("fixture").digest("hex");
    const first = await extractEmbeddedResources(data, hash, resources);
    const migration = join(first.migrationsDir, "0000.sql");
    expect(await readFile(migration, "utf8")).toBe("SELECT 1;");
    const reused = await extractEmbeddedResources(data, hash, resources);
    expect(reused.root).toBe(first.root);
    await writeFile(migration, "damaged");
    await extractEmbeddedResources(data, hash, resources);
    expect(await readFile(migration, "utf8")).toBe("SELECT 1;");
  });
});

describe("embedded static site", () => {
  const site = new EmbeddedStaticSite([
    embedded("index.html", "<main>studio</main>"),
    embedded("_next/static/app.js", "console.log('ok')"),
    embedded("image.png", "png"),
  ]);

  test("serves MIME types, immutable assets, and SPA entry points", async () => {
    const script = site.response("/_next/static/app.js")!;
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(script.headers.get("cache-control")).toContain("immutable");
    expect(await site.response("/settings")!.text()).toContain("studio");
    expect(site.response("/missing.png")).toBeNull();
  });

  test("does not turn API 404s into the SPA", () => {
    expect(site.response("/api/not-found")).toBeNull();
  });
});

describe("dynamic server port", () => {
  test("lets Windows assign an available port even while other ports are occupied", async () => {
    const occupied = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("busy") });
    const secondOccupied = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("busy") });
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect([occupied.port, secondOccupied.port]).not.toContain(server.port);
      expect(await (await fetch(`http://127.0.0.1:${server.port}`)).text()).toBe("ok");
    } finally {
      await Promise.all([server.stop(true), occupied.stop(true), secondOccupied.stop(true)]);
    }
  });
});
