import type { GenerationConfig, JobPhase } from "@anima/shared";

export type ComfyLink = [nodeId: string, outputIndex: number];

export interface ComfyPromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ComfyPrompt = Record<string, ComfyPromptNode>;

export type OutputKind = "base" | "upscale";

export type WorkflowNodePhase = Extract<
  JobPhase,
  | "loading_models"
  | "training"
  | "encoding"
  | "sampling"
  | "upscaling"
  | "saving"
>;

export interface BuiltWorkflow {
  prompt: ComfyPrompt;
  actualSeed: number;
  nodePhases: Record<string, WorkflowNodePhase>;
  nodeLabels: Record<string, string>;
  outputKinds: Record<string, OutputKind>;
  outputNodeIds: {
    base?: string;
    upscale?: string;
  };
  autoTagsNodeId: string;
  autoTagsSource: ComfyLink;
}

export interface WorkflowBuildOptions {
  /**
   * Makes random-seed builds deterministic in tests or in a job transaction.
   * Production callers normally omit this.
   */
  randomSeed?: () => number;
  baseFilenamePrefix?: string;
  upscaleFilenamePrefix?: string;
  autoTagsFilenamePrefix?: string;
}

export interface ManifestNodeContract {
  classType: string;
  requiredInputs: string[];
  optionalInputs?: string[];
  flexibleInputs?: string[];
  outputs: string[];
}

export interface ManifestPackage {
  id: string;
  name: string;
  builtIn: boolean;
  installUrl: string;
  nodes: ManifestNodeContract[];
}

export interface WorkflowManifest {
  schemaVersion: number;
  workflow: string;
  packages: ManifestPackage[];
}

export interface ComfyObjectInfoNode {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
  output?: string[];
  output_name?: string[];
  python_module?: string;
}

export type ComfyObjectInfo = Record<string, ComfyObjectInfoNode>;

export interface NodeCapabilityIssue {
  classType: string;
  packageId: string;
  packageName: string;
  installUrl: string;
  reason: "missing" | "contract";
  missingInputs: string[];
  outputMismatches: Array<{
    index: number;
    expected: string;
    actual: string | null;
  }>;
}

export interface WorkflowCapabilityInspection {
  compatible: boolean;
  available: string[];
  missing: NodeCapabilityIssue[];
  incompatible: NodeCapabilityIssue[];
}

export interface PortabilityViolation {
  path: string;
  reason: string;
}

export type { GenerationConfig };
