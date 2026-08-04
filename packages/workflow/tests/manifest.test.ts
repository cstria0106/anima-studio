import { describe, expect, test } from "bun:test";

import {
  assertPortableTemplate,
  findPortabilityViolations,
  inspectCapabilities,
  manifest,
  REQUIRED_NODE_CONTRACTS,
  featureNodeContracts,
  requiredNodes,
  requiredNodesForFeature,
  SANITIZED_ANIMA_TEMPLATE,
} from "../src";
import type { ComfyObjectInfo } from "../src";

function compatibleObjectInfo(): ComfyObjectInfo {
  return Object.fromEntries(
    REQUIRED_NODE_CONTRACTS.map((contract) => [
      contract.classType,
      {
        input: {
          required: Object.fromEntries(
            contract.requiredInputs.map((name) => [name, ["ANY"]]),
          ),
          optional: Object.fromEntries(
            (contract.optionalInputs ?? []).map((name) => [name, ["ANY"]]),
          ),
        },
        output: contract.outputs,
      },
    ]),
  );
}

describe("portable template", () => {
  test("contains no private paths or transient ComfyUI metadata", () => {
    expect(findPortabilityViolations(SANITIZED_ANIMA_TEMPLATE)).toEqual([]);
    expect(() =>
      assertPortableTemplate(SANITIZED_ANIMA_TEMPLATE),
    ).not.toThrow();

    const serialized = JSON.stringify(SANITIZED_ANIMA_TEMPLATE);
    expect(serialized).not.toContain("Screenshot_");
    expect(serialized).not.toContain("C:\\Users\\");
    expect(serialized).not.toContain("client_id");
    expect(serialized).not.toContain("prompt_id");
    expect(serialized).not.toContain("extra_pnginfo");
    expect(serialized).not.toContain("__lm_autocomplete_meta_text");
    expect(serialized).not.toContain("anima_baseV10.safetensors");
  });

  test("detects local paths and forbidden metadata recursively", () => {
    const unsafe = {
      graph: {
        client_id: "temporary",
        image: "C:\\Users\\someone\\Desktop\\reference.png",
      },
    };

    expect(findPortabilityViolations(unsafe)).toEqual([
      {
        path: "$.graph.client_id",
        reason: "transient ComfyUI metadata",
      },
      {
        path: "$.graph.image",
        reason: "Windows user path",
      },
    ]);
    expect(() => assertPortableTemplate(unsafe)).toThrow("not portable");
  });
});

describe("custom-node contract manifest", () => {
  test("keeps required node exports in sync with the package manifest", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(requiredNodes).toEqual(
      manifest.packages.flatMap((entry) =>
        entry.nodes.filter((node) => !node.feature).map((node) => node.classType),
      ),
    );
    expect(new Set(requiredNodes).size).toBe(requiredNodes.length);
  });

  test("checks inpaint nodes only for the inpaint feature", () => {
    const contracts = featureNodeContracts("inpaint");
    const objectInfo = Object.fromEntries(
      contracts.map((contract) => [
        contract.classType,
        {
          input: {
            required: Object.fromEntries(
              contract.requiredInputs.map((name) => [name, ["ANY"]]),
            ),
            optional: Object.fromEntries(
              (contract.optionalInputs ?? []).map((name) => [name, ["ANY"]]),
            ),
          },
          output: contract.outputs,
        },
      ]),
    );
    expect(inspectCapabilities(objectInfo)).toMatchObject({ compatible: true });
    expect(inspectCapabilities(objectInfo, "inpaint")).toMatchObject({
      compatible: true,
      available: requiredNodesForFeature("inpaint"),
    });

    delete objectInfo.VAEEncodeForInpaint;
    expect(inspectCapabilities(objectInfo)).toMatchObject({ compatible: true });
    expect(inspectCapabilities(objectInfo, "inpaint")).toMatchObject({
      compatible: false,
      missing: [{ classType: "VAEEncodeForInpaint" }],
    });
  });

  test("accepts matching /object_info contracts", () => {
    const report = inspectCapabilities(compatibleObjectInfo());

    expect(report.compatible).toBeTrue();
    expect(report.missing).toEqual([]);
    expect(report.incompatible).toEqual([]);
    expect(report.available).toEqual([...requiredNodes]);
  });

  test("distinguishes missing nodes from incompatible contracts", () => {
    const objectInfo = compatibleObjectInfo();
    delete objectInfo.InstantReferenceLoRA;
    objectInfo.ScheduledCFGGuidance = {
      input: {
        required: {
          model: ["MODEL"],
        },
      },
      output: ["CONDITIONING"],
    };

    const report = inspectCapabilities(objectInfo);

    expect(report.compatible).toBeFalse();
    expect(report.missing.map((issue) => issue.classType)).toEqual([
      "InstantReferenceLoRA",
    ]);
    expect(report.incompatible).toHaveLength(1);
    expect(report.incompatible[0]?.classType).toBe("ScheduledCFGGuidance");
    expect(report.incompatible[0]?.missingInputs).toContain("positive");
    expect(report.incompatible[0]?.outputMismatches).toEqual([
      { index: 0, expected: "GUIDER", actual: "CONDITIONING" },
    ]);
  });
});
