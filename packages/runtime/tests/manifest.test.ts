import { describe, expect, test } from "bun:test";

import {
  MANAGED_ENGINE_MANIFEST,
  createRuntimeSbom,
  renderThirdPartyNotices,
  validateEngineManifest,
} from "../src";

describe("managed engine manifest", () => {
  test("pins every runtime input and keeps ComfyUI loopback-only", () => {
    const manifest = validateEngineManifest(MANAGED_ENGINE_MANIFEST);

    expect(manifest.bundleId).toBe(
      "anima-comfy-0.29.0-win-nvidia-r4",
    );
    expect(manifest.artifacts).toHaveLength(10);
    expect(
      manifest.artifacts.every(
        (artifact) =>
          /^[a-f0-9]{40}$/.test(artifact.revision) &&
          /^[a-f0-9]{64}$/.test(artifact.sha256) &&
          artifact.bytes > 0 &&
          !artifact.downloadUrl.includes("latest"),
      ),
    ).toBeTrue();
    expect(manifest.launch.host).toBe("127.0.0.1");
    expect(manifest.launch.arguments).toContain("--disable-all-custom-nodes");
    expect(manifest.launch.arguments).toContain("--whitelist-custom-nodes");
    expect(manifest.launch.arguments).not.toContain("--fast");
    expect(manifest.artifacts.find((item) => item.id === "python312"))
      .toMatchObject({ version: "3.12.13+20260728" });
    expect(manifest.artifacts.find((item) => item.id === "uv"))
      .toMatchObject({ version: "0.12.0" });
    expect(manifest.artifacts.find((item) => item.id === "7zr"))
      .toMatchObject({ version: "26.02" });
  });

  test("rejects unsafe paths, mutable latest URLs, and quality-changing flags", () => {
    const unsafePath = structuredClone(MANAGED_ENGINE_MANIFEST);
    unsafePath.artifacts[0]!.destination = "../outside";
    expect(() => validateEngineManifest(unsafePath)).toThrow(
      "must not escape",
    );

    const latest = structuredClone(MANAGED_ENGINE_MANIFEST);
    latest.artifacts[0]!.downloadUrl =
      "https://example.test/releases/latest/tool.exe";
    expect(() => validateEngineManifest(latest)).toThrow("immutable");

    const fast = structuredClone(MANAGED_ENGINE_MANIFEST);
    fast.launch.arguments.push("--fast");
    expect(() => validateEngineManifest(fast)).toThrow("--fast");
  });

  test("generates a source-correspondence notice and CycloneDX inventory", () => {
    const notices = renderThirdPartyNotices(MANAGED_ENGINE_MANIFEST);
    const sbom = createRuntimeSbom(MANAGED_ENGINE_MANIFEST);
    const licenses = Object.fromEntries(
      MANAGED_ENGINE_MANIFEST.artifacts.map((artifact) => [
        artifact.id,
        artifact.license,
      ]),
    );

    expect(notices).toContain("ComfyUI LoRA Optimizer 1.4.5");
    expect(notices).toContain("ComfyUI KJNodes 1.3.3");
    expect(licenses).toMatchObject({
      "instant-reference": "MIT",
      kjnodes: "GPL-3.0",
      "lora-optimizer": "MIT",
    });
    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.components).toHaveLength(
      MANAGED_ENGINE_MANIFEST.artifacts.length,
    );
  });
});
