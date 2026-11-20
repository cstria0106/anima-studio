import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MANAGED_ENGINE_MANIFEST } from "@anima/runtime";

import { validateManagedCustomNodeAllowlist } from "./provision";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function releaseWithCustomNodes(names: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anima-allowlist-"));
  roots.push(root);
  await Promise.all(
    names.map((name) =>
      mkdir(join(root, "ComfyUI", "custom_nodes", name), { recursive: true }),
    ),
  );
  return root;
}

const manifestCustomNodes = [
  ...new Set(
    MANAGED_ENGINE_MANIFEST.artifacts.flatMap((artifact) => {
      const match = /^ComfyUI\/custom_nodes\/([^/]+)/.exec(
        artifact.destination,
      );
      return match?.[1] ? [match[1]] : [];
    }),
  ),
];

describe("managed custom node allowlist", () => {
  test("accepts every custom node the engine manifest installs and launches", async () => {
    expect(manifestCustomNodes.length).toBeGreaterThan(0);
    for (const name of manifestCustomNodes) {
      expect(MANAGED_ENGINE_MANIFEST.launch.arguments).toContain(name);
    }

    const releaseRoot = await releaseWithCustomNodes(manifestCustomNodes);
    await expect(
      validateManagedCustomNodeAllowlist(releaseRoot),
    ).resolves.toBeUndefined();
  });

  test("rejects a custom node the manifest does not install", async () => {
    const releaseRoot = await releaseWithCustomNodes([
      ...manifestCustomNodes,
      "unexpected-node",
    ]);
    await expect(
      validateManagedCustomNodeAllowlist(releaseRoot),
    ).rejects.toThrow("unexpected-node");
  });
});
