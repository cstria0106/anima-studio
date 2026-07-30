import {
  type CapabilityReport,
  type ComfyOptions,
} from "@anima/shared";
import type { ComfyClientLike } from "../comfy/client";
import type { WorkflowEngine } from "../workflow/engine";

export class CapabilityService {
  private cachedOptions: { value: ComfyOptions; expiresAt: number } | null =
    null;
  private cachedReport: { value: CapabilityReport; expiresAt: number } | null =
    null;

  constructor(
    private readonly comfy: ComfyClientLike,
    private readonly workflow: WorkflowEngine,
  ) {}

  invalidate(): void {
    this.cachedOptions = null;
    this.cachedReport = null;
  }

  async report(): Promise<CapabilityReport> {
    if (this.cachedReport && this.cachedReport.expiresAt > Date.now()) {
      return this.cachedReport.value;
    }
    try {
      const objectInfo = await this.comfy.getObjectInfo();
      const report = this.workflow.capabilities(objectInfo, this.comfy.baseUrl);
      this.cachedReport = { value: report, expiresAt: Date.now() + 10_000 };
      return report;
    } catch (error) {
      return {
        compatible: false,
        comfyUrl: this.comfy.baseUrl,
        requiredNodes: [],
        missing: [
          {
            kind: "endpoint",
            id: "comfyui",
            label:
              error instanceof Error
                ? error.message
                : "Could not connect to ComfyUI.",
          },
        ],
        optional: [],
      };
    }
  }

  async options(): Promise<ComfyOptions> {
    if (this.cachedOptions && this.cachedOptions.expiresAt > Date.now()) {
      return this.cachedOptions.value;
    }
    const value = await this.comfy.getOptions();
    this.cachedOptions = { value, expiresAt: Date.now() + 10_000 };
    return value;
  }
}
