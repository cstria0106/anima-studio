import rawManifest from "../custom-nodes.manifest.json";

import type {
  ComfyObjectInfo,
  ManifestNodeContract,
  NodeCapabilityIssue,
  WorkflowCapabilityInspection,
  WorkflowManifest,
} from "./types";

export const manifest = rawManifest as WorkflowManifest;

export const REQUIRED_NODE_CONTRACTS: readonly ManifestNodeContract[] =
  manifest.packages.flatMap((entry) => entry.nodes);

export const requiredNodes: readonly string[] = Object.freeze(
  REQUIRED_NODE_CONTRACTS.map((contract) => contract.classType),
);

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function inspectContract(
  objectInfo: ComfyObjectInfo,
  contract: ManifestNodeContract,
): NodeCapabilityIssue | null {
  const packageEntry = manifest.packages.find((entry) =>
    entry.nodes.some((node) => node.classType === contract.classType),
  );

  if (!packageEntry) {
    throw new Error(`Manifest package missing for ${contract.classType}`);
  }

  const actual = objectInfo[contract.classType];
  if (!actual) {
    return {
      classType: contract.classType,
      packageId: packageEntry.id,
      packageName: packageEntry.name,
      installUrl: packageEntry.installUrl,
      reason: "missing",
      missingInputs: [],
      outputMismatches: [],
    };
  }

  const required = actual.input?.required ?? {};
  const optional = actual.input?.optional ?? {};
  const acceptedInputs: Record<string, unknown> = { ...required, ...optional };
  const missingInputs = [
    ...contract.requiredInputs,
    ...(contract.optionalInputs ?? []),
  ].filter((name) => !hasOwn(acceptedInputs, name));

  const actualOutputs = actual.output ?? [];
  const outputMismatches = contract.outputs.flatMap((expected, index) => {
    const output = actualOutputs[index] ?? null;
    return output === expected
      ? []
      : [{ index, expected, actual: output }];
  });

  if (missingInputs.length === 0 && outputMismatches.length === 0) {
    return null;
  }

  return {
    classType: contract.classType,
    packageId: packageEntry.id,
    packageName: packageEntry.name,
    installUrl: packageEntry.installUrl,
    reason: "contract",
    missingInputs,
    outputMismatches,
  };
}

/**
 * Compares live ComfyUI `/object_info` data with the inputs and output indexes
 * used by the portable prompt builder. Package versions are intentionally not
 * used as a compatibility proxy.
 */
export function inspectCapabilities(
  objectInfo: ComfyObjectInfo,
): WorkflowCapabilityInspection {
  const issues = REQUIRED_NODE_CONTRACTS.map((contract) =>
    inspectContract(objectInfo, contract),
  ).filter((issue): issue is NodeCapabilityIssue => issue !== null);

  const missing = issues.filter((issue) => issue.reason === "missing");
  const incompatible = issues.filter((issue) => issue.reason === "contract");
  const unavailable = new Set(issues.map((issue) => issue.classType));

  return {
    compatible: issues.length === 0,
    available: requiredNodes.filter((classType) => !unavailable.has(classType)),
    missing,
    incompatible,
  };
}
