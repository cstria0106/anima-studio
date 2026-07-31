import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveRuntimePaths,
  validateEngineManifest,
  type EngineArtifact,
  type EngineManifest,
} from "@anima/runtime";

import {
  type ArtifactDownloader,
  ResumableArtifactDownloader,
} from "./download";
import type { ArchiveExtractor } from "./extract";
import { ManagedRuntimeInstaller } from "./installer";
import {
  MANAGED_INSTANT_REFERENCE_SETUP_VERSION,
  NoopRuntimeProvisioner,
  isManagedInstantReferenceRuntimeReady,
  managedInstantReferenceRuntimeRoot,
  managedInstantReferenceUvEnvironment,
  patchInstantReferenceRuntimeSource,
  patchSharedRuntimeProjectSource,
} from "./provision";
import {
  initialRuntimeState,
  MemoryRuntimeStateRepository,
} from "./repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "anima-runtime-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tinyManifest(bytes = Uint8Array.of(1, 2, 3)): EngineManifest {
  return validateEngineManifest({
    schemaVersion: 1,
    bundleId: "tiny-runtime-r1",
    displayName: "Tiny test runtime",
    platform: {
      os: "win32",
      architecture: "x64",
      accelerator: "nvidia",
      minimumFreeBytes: 1,
      recommendedVramMiB: 1,
    },
    launch: {
      executable: "python/python.exe",
      entrypoint: "ComfyUI/main.py",
      arguments: [
        "{entrypoint}",
        "--listen",
        "{host}",
        "--port",
        "{port}",
      ],
      host: "127.0.0.1",
      portRange: { from: 8188, to: 8189 },
      readinessTimeoutMs: 1_000,
    },
    sharedDirectories: ["models", "input", "output", "temp", "user", "cache"],
    artifacts: [
      {
        id: "tiny-engine",
        kind: "engine",
        name: "Tiny engine",
        version: "1.0.0",
        revision: "a".repeat(40),
        downloadUrl: "https://example.test/tiny.zip",
        sourceUrl: `https://example.test/source/${"a".repeat(40)}`,
        bytes: bytes.byteLength,
        sha256: digest(bytes),
        license: "MIT",
        archive: { format: "zip", stripComponents: 0 },
        destination: ".",
      },
    ],
  });
}

class FakeDownloader implements ArtifactDownloader {
  constructor(private readonly archive: string) {}

  download(
    artifact: EngineArtifact,
    _directory: string,
    options?: {
      signal?: AbortSignal;
      onProgress?(progress: {
        artifactId: string;
        currentBytes: number;
        totalBytes: number;
      }): void;
    },
  ): Promise<string> {
    options?.onProgress?.({
      artifactId: artifact.id,
      currentBytes: artifact.bytes,
      totalBytes: artifact.bytes,
    });
    return Promise.resolve(this.archive);
  }
}

class FakeExtractor implements ArchiveExtractor {
  constructor(private readonly fail = false) {}

  async extract(
    artifact: EngineArtifact,
    _archivePath: string,
    releaseRoot: string,
  ): Promise<void> {
    if (this.fail) throw new Error("synthetic extraction failure");
    await mkdir(join(releaseRoot, "payload"), { recursive: true });
    await writeFile(join(releaseRoot, "payload", artifact.id), "installed");
  }
}

function compatiblePlatform() {
  return {
    inspect: async () => ({
      platform: "win32",
      architecture: "x64",
      freeBytes: 1_000_000,
      nvidiaDevices: [{ name: "Test GPU", vramMiB: 24_576 }],
    }),
  };
}

describe("managed runtime installer", () => {
  test("activates only a fully extracted staging release", async () => {
    const root = await temporaryDirectory();
    const archive = join(root, "archive.zip");
    await writeFile(archive, Uint8Array.of(1, 2, 3));
    const repository = new MemoryRuntimeStateRepository(
      initialRuntimeState("managed"),
    );
    const installer = new ManagedRuntimeInstaller({
      paths: resolveRuntimePaths(root),
      repository,
      manifest: tinyManifest(),
      platformProbe: compatiblePlatform(),
      downloader: new FakeDownloader(archive),
      extractor: new FakeExtractor(),
      provisioner: new NoopRuntimeProvisioner(),
    });

    const result = await installer.install({ operationId: "operation-123" });
    const files = await readdir(result.releaseRoot);

    expect(result.operationId).toBe("operation-123");
    expect(result.reused).toBeFalse();
    expect(files).toContain(".anima-runtime.json");
    expect(files).toContain("THIRD_PARTY_NOTICES.md");
    expect(files).toContain("runtime.cdx.json");
    expect(await readFile(join(result.releaseRoot, "payload", "tiny-engine"), "utf8"))
      .toBe("installed");
    expect((await repository.getState()).status).toBe("stopped");
    expect(repository.events.at(-1)).toMatchObject({
      operationId: "operation-123",
      phase: "complete",
    });
  });

  test("removes failed staging data and never exposes a partial release", async () => {
    const root = await temporaryDirectory();
    const archive = join(root, "archive.zip");
    await writeFile(archive, Uint8Array.of(1, 2, 3));
    const paths = resolveRuntimePaths(root);
    const repository = new MemoryRuntimeStateRepository();
    const installer = new ManagedRuntimeInstaller({
      paths,
      repository,
      manifest: tinyManifest(),
      platformProbe: compatiblePlatform(),
      downloader: new FakeDownloader(archive),
      extractor: new FakeExtractor(true),
      provisioner: new NoopRuntimeProvisioner(),
    });

    await expect(installer.install()).rejects.toThrow(
      "synthetic extraction failure",
    );
    expect(
      await readdir(paths.releases).catch(() => []),
    ).toEqual([]);
    expect((await repository.getState()).status).toBe("failed");
  });

  test("repairs by quarantining an invalid release instead of deleting it", async () => {
    const root = await temporaryDirectory();
    const archive = join(root, "archive.zip");
    await writeFile(archive, Uint8Array.of(1, 2, 3));
    const paths = resolveRuntimePaths(root);
    await mkdir(join(paths.releases, "tiny-runtime-r1"), { recursive: true });
    await writeFile(
      join(paths.releases, "tiny-runtime-r1", "broken.txt"),
      "preserve",
    );
    const repository = new MemoryRuntimeStateRepository();
    const installer = new ManagedRuntimeInstaller({
      paths,
      repository,
      manifest: tinyManifest(),
      platformProbe: compatiblePlatform(),
      downloader: new FakeDownloader(archive),
      extractor: new FakeExtractor(),
      provisioner: new NoopRuntimeProvisioner(),
    });

    await installer.install({ operation: "repair" });
    const releases = await readdir(paths.releases);

    expect(releases).toContain("tiny-runtime-r1");
    expect(
      releases.some((name) =>
        name.startsWith("tiny-runtime-r1.quarantine-"),
      ),
    ).toBeTrue();
  });

  test("repair reinstalls a damaged release even when its marker is valid", async () => {
    const root = await temporaryDirectory();
    const archive = join(root, "archive.zip");
    await writeFile(archive, Uint8Array.of(1, 2, 3));
    const paths = resolveRuntimePaths(root);
    const repository = new MemoryRuntimeStateRepository();
    const installer = new ManagedRuntimeInstaller({
      paths,
      repository,
      manifest: tinyManifest(),
      platformProbe: compatiblePlatform(),
      downloader: new FakeDownloader(archive),
      extractor: new FakeExtractor(),
      provisioner: new NoopRuntimeProvisioner(),
    });
    const installed = await installer.install({
      operationId: "initial-install",
    });
    await rm(join(installed.releaseRoot, "payload", "tiny-engine"));

    const repaired = await installer.install({
      operation: "repair",
      operationId: "repair-valid-marker",
    });
    const releases = await readdir(paths.releases);

    expect(repaired.reused).toBeFalse();
    expect(
      await readFile(
        join(repaired.releaseRoot, "payload", "tiny-engine"),
        "utf8",
      ),
    ).toBe("installed");
    expect(
      releases.some((name) =>
        name.startsWith("tiny-runtime-r1.quarantine-"),
      ),
    ).toBeTrue();
    expect(
      repository.events.some(
        (event) =>
          event.operationId === "repair-valid-marker" &&
          event.phase === "quarantine",
      ),
    ).toBeTrue();
  });

});

describe("resumable artifact download", () => {
  test("resumes a partial file and verifies size and SHA-256 before activation", async () => {
    const directory = await temporaryDirectory();
    const bytes = new TextEncoder().encode("verified artifact");
    const manifest = tinyManifest(bytes);
    const artifact = manifest.artifacts[0]!;
    const finalName = `${artifact.id}-${artifact.sha256.slice(0, 16)}.zip`;
    await writeFile(join(directory, `${finalName}.part`), bytes.slice(0, 8));
    const downloader = new ResumableArtifactDownloader(
      (async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
          expect(new Headers(init?.headers).get("range")).toBe("bytes=8-");
          return new Response(bytes.slice(8), {
            status: 206,
            headers: {
              "content-range": `bytes 8-${bytes.byteLength - 1}/${bytes.byteLength}`,
            },
          });
        }) as unknown as typeof fetch,
    );

    const path = await downloader.download(artifact, directory);

    expect([...(await readFile(path))]).toEqual([...bytes]);
  });
});

describe("Instant Reference managed patch", () => {
  test("removes implicit Python, pip and Git bootstrap paths", () => {
    const source = [
      'SETUP_VERSION = "12"',
      "",
      "def runtime_root() -> Path:",
      '    return plugin_root() / "runtime"',
      "",
      "def ensure_uv(paths: RuntimePaths, log_path: Path | None = None) -> str:",
      "    install_with_pip()",
      "",
      "def runtime_project_dir() -> Path:",
      "    return root",
      "",
      "def resolve_runtime_python() -> str:",
      '    return run(["py", "-3.12"])',
      "",
      "def runtime_imports_ready(value):",
      "    return True",
      "",
      "def ensure_sd_scripts_checkout(paths: RuntimePaths, log_path: Path | None = None) -> None:",
      '    run_command(["git", "clone"])',
      "",
      "def ensure_sd_scripts_environment(paths):",
      "    run_command(",
      "        [",
      "            uv,",
      '            "sync",',
      "        ]",
      "    )",
    ].join("\n");

    const patched = patchInstantReferenceRuntimeSource(source);

    expect(patched).toContain("INSTANT_REFERENCE_PYTHON");
    expect(patched).toContain("INSTANT_REFERENCE_RUNTIME_DIR");
    expect(patched).toContain(
      `SETUP_VERSION = "${MANAGED_INSTANT_REFERENCE_SETUP_VERSION}"`,
    );
    expect(patched).toContain('"--frozen"');
    expect(patched).not.toContain('["git", "clone"]');
    expect(patched).not.toContain("install_with_pip");
  });

  test("pins the editable sd-scripts dependency to the shared runtime", () => {
    const pyproject = [
      "[tool.uv.sources]",
      'library = { path = "../runtime/sd-scripts", editable = true }',
    ].join("\n");
    const lock = [
      'name = "library"',
      'source = { editable = "../runtime/sd-scripts" }',
    ].join("\n");

    expect(patchSharedRuntimeProjectSource(pyproject)).toContain(
      'path = "../sd-scripts"',
    );
    expect(patchSharedRuntimeProjectSource(lock)).toContain(
      'editable = "../sd-scripts"',
    );
  });

  test("isolates the trainer and uv cache under a short stable bundle path", () => {
    const paths = resolveRuntimePaths("C:\\anima-data");
    const runtimeRoot = managedInstantReferenceRuntimeRoot(
      paths,
      "bundle-r1",
    );

    expect(runtimeRoot).toBe(
      join(paths.root, "ir", "9f7e10b559ca"),
    );
    expect(runtimeRoot.length - paths.root.length).toBe(16);
    expect(managedInstantReferenceUvEnvironment(paths, "bundle-r1")).toEqual({
      UV_CACHE_DIR: join(runtimeRoot, "uv"),
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    });
    expect(runtimeRoot.startsWith(`${paths.root}\\`)).toBeTrue();
  });

  test("accepts a current ready marker only after imports succeed", async () => {
    const root = await temporaryDirectory();
    const marker = join(root, ".sd_scripts_ready");
    await writeFile(
      marker,
      `${MANAGED_INSTANT_REFERENCE_SETUP_VERSION}\n`,
    );

    expect(
      await isManagedInstantReferenceRuntimeReady(
        marker,
        async () => {},
      ),
    ).toBeTrue();
  });

  test("rejects an outdated ready marker", async () => {
    const root = await temporaryDirectory();
    const marker = join(root, ".sd_scripts_ready");
    await writeFile(marker, "12\n");

    expect(
      await isManagedInstantReferenceRuntimeReady(
        marker,
        async () => {},
      ),
    ).toBeFalse();
  });

  test("rejects a current ready marker when imports fail", async () => {
    const root = await temporaryDirectory();
    const marker = join(root, ".sd_scripts_ready");
    await writeFile(
      marker,
      `${MANAGED_INSTANT_REFERENCE_SETUP_VERSION}\n`,
    );

    expect(
      await isManagedInstantReferenceRuntimeReady(marker, async () => {
        throw new Error("library is missing");
      }),
    ).toBeFalse();
  });

});
