import type {
  CapabilityIssue,
  CapabilityReport,
  GenerationConfig,
  JobPhase,
} from "@anima/shared";
import {
  buildInpaintWorkflow,
  buildUpscaleWorkflow,
  buildWorkflow,
  inspectCapabilities,
  manifest,
  requiredNodes,
  requiredNodesForFeature,
  type BuiltWorkflow,
  type ComfyObjectInfo as WorkflowObjectInfo,
  type WorkflowFeature,
} from "@anima/workflow";
import type { ComfyObjectInfo, ComfyPrompt } from "../comfy/types";

export interface WorkflowBuildResult {
  prompt: ComfyPrompt;
  actualSeed: number;
  nodePhases: Record<string, JobPhase>;
  nodeLabels: Record<string, string>;
  outputKinds: Record<string, "base" | "upscale" | "inpaint">;
  autoTagsNodeId: string | null;
  autoTagsOutputIndex: number | null;
}

export interface WorkflowEngine {
  build(
    config: GenerationConfig,
    uploadedInputNames: string[],
    actualSeed: number,
  ): WorkflowBuildResult;
  buildUpscale(
    config: GenerationConfig,
    uploadedInputNames: string[],
    baseImageInputName: string,
    actualSeed: number,
  ): WorkflowBuildResult;
  buildInpaint(
    config: GenerationConfig,
    uploadedInputNames: string[],
    sourceImageInputName: string,
    maskImageInputName: string,
    growMaskBy: number,
    actualSeed: number,
  ): WorkflowBuildResult;
  capabilities(
    objectInfo: ComfyObjectInfo,
    comfyUrl: string,
    feature?: WorkflowFeature,
  ): CapabilityReport;
}

function packageFor(classType: string) {
  return manifest.packages.find((entry) =>
    entry.nodes.some((node) => node.classType === classType),
  );
}

function issueFromInspection(
  issue: ReturnType<typeof inspectCapabilities>["missing"][number],
): CapabilityIssue {
  const contractDetails =
    issue.reason === "contract"
      ? [
          issue.missingInputs.length > 0
            ? `missing inputs: ${issue.missingInputs.join(", ")}`
            : "",
          issue.outputMismatches.length > 0
            ? `incompatible outputs: ${issue.outputMismatches
                .map(
                  (entry) =>
                    `${entry.index} expected ${entry.expected}, got ${entry.actual ?? "none"}`,
                )
                .join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("; ")
      : "";
  return {
    kind: "node",
    id: issue.classType,
    label: contractDetails
      ? `${issue.classType} (${contractDetails})`
      : issue.classType,
    package: issue.packageName,
    installUrl: issue.installUrl,
  };
}

export class PortableWorkflowEngine implements WorkflowEngine {
  private result(built: BuiltWorkflow): WorkflowBuildResult {
    return {
      prompt: built.prompt,
      actualSeed: built.actualSeed,
      nodePhases: built.nodePhases,
      nodeLabels: built.nodeLabels,
      outputKinds: built.outputKinds,
      autoTagsNodeId: built.autoTagsNodeId,
      autoTagsOutputIndex: built.autoTagsSource?.[1] ?? null,
    };
  }

  build(
    config: GenerationConfig,
    uploadedInputNames: string[],
    actualSeed: number,
  ): WorkflowBuildResult {
    const built: BuiltWorkflow = buildWorkflow(config, uploadedInputNames, {
      randomSeed: () => actualSeed,
      baseFilenamePrefix: "AnimaStudio/base",
      upscaleFilenamePrefix: "AnimaStudio/upscale",
      autoTagsFilenamePrefix: "AnimaStudio/tags",
    });
    return this.result(built);
  }

  buildUpscale(
    config: GenerationConfig,
    uploadedInputNames: string[],
    baseImageInputName: string,
    actualSeed: number,
  ): WorkflowBuildResult {
    const built = buildUpscaleWorkflow(
      config,
      uploadedInputNames,
      baseImageInputName,
      {
        randomSeed: () => actualSeed,
        upscaleFilenamePrefix: "AnimaStudio/upscale",
        autoTagsFilenamePrefix: "AnimaStudio/tags",
      },
    );
    return this.result(built);
  }

  buildInpaint(
    config: GenerationConfig,
    uploadedInputNames: string[],
    sourceImageInputName: string,
    maskImageInputName: string,
    growMaskBy: number,
    actualSeed: number,
  ): WorkflowBuildResult {
    const built = buildInpaintWorkflow(
      config,
      uploadedInputNames,
      sourceImageInputName,
      maskImageInputName,
      growMaskBy,
      {
        randomSeed: () => actualSeed,
        inpaintFilenamePrefix: "AnimaStudio/inpaint",
        autoTagsFilenamePrefix: "AnimaStudio/tags",
      },
    );
    return this.result(built);
  }

  capabilities(
    objectInfo: ComfyObjectInfo,
    comfyUrl: string,
    feature?: WorkflowFeature,
  ): CapabilityReport {
    const result = inspectCapabilities(
      objectInfo as unknown as WorkflowObjectInfo,
      feature,
    );
    const required = feature
      ? [...requiredNodesForFeature(feature)]
      : [...requiredNodes];
    const missing = [
      ...result.missing.map(issueFromInspection),
      ...result.incompatible.map(issueFromInspection),
    ];

    return {
      compatible: result.compatible,
      comfyUrl,
      requiredNodes: required,
      missing,
      optional: manifest.packages
        .filter((entry) => !entry.builtIn)
        .flatMap((entry) =>
          entry.nodes
            .filter((node) => !required.includes(node.classType))
            .map((node) => ({
              kind: "node" as const,
              id: node.classType,
              label: node.classType,
              package: entry.name,
              installUrl: entry.installUrl,
            })),
        ),
    };
  }
}

export function nodeInstallHint(classType: string): string {
  const packageEntry = packageFor(classType);
  if (!packageEntry) return classType;
  return `${classType} (${packageEntry.name}: ${packageEntry.installUrl})`;
}
