import {
  variationBatchRequestSchema,
  type GenerationConfig,
  type VariationAxis,
  type VariationBatchDto,
} from "@anima/shared";
import { StudioRepository } from "../db/repository";
import { JobService, JobSubmissionError } from "./jobs";

interface ExpandedVariation {
  label: string;
  config: GenerationConfig;
}

function axisOptions(
  axis: VariationAxis,
): Array<{
  label: string;
  apply(config: GenerationConfig): GenerationConfig;
}> {
  if (axis.kind === "seed") {
    return axis.values.map((raw) => {
      const value = typeof raw === "number" ? raw : raw.value;
      const label =
        typeof raw === "number" ? `Seed ${raw}` : (raw.label ?? `Seed ${value}`);
      return {
        label,
        apply: (config) => ({
          ...config,
          seed: { mode: "fixed", value },
        }),
      };
    });
  }
  return axis.values.map((raw, index) => {
    const patch =
      typeof raw === "string"
        ? { positive: raw }
        : {
            ...(raw.positive !== undefined
              ? { positive: raw.positive }
              : {}),
            ...(raw.natural !== undefined
              ? { natural: raw.natural }
              : {}),
            ...(raw.negative !== undefined
              ? { negative: raw.negative }
              : {}),
          };
    const label =
      typeof raw === "string"
        ? `Prompt ${index + 1}`
        : (raw.label ?? `Prompt ${index + 1}`);
    return {
      label,
      apply: (config) => ({
        ...config,
        prompts: { ...config.prompts, ...patch },
      }),
    };
  });
}

function expandAxes(
  baseConfig: GenerationConfig,
  axes: VariationAxis[],
): ExpandedVariation[] {
  return axes.reduce<ExpandedVariation[]>(
    (combinations, axis) =>
      combinations.flatMap((combination) =>
        axisOptions(axis).map((option) => ({
          label: combination.label
            ? `${combination.label} · ${option.label}`
            : option.label,
          config: option.apply(structuredClone(combination.config)),
        })),
      ),
    [{ label: "", config: structuredClone(baseConfig) }],
  );
}

export class VariationBatchService {
  constructor(
    private readonly repository: StudioRepository,
    private readonly jobs: JobService,
  ) {}

  async create(raw: unknown): Promise<VariationBatchDto> {
    const parsed = variationBatchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JobSubmissionError(
        "Variation batch settings are invalid.",
        422,
        parsed.error.flatten(),
      );
    }
    const expanded: ExpandedVariation[] =
      parsed.data.combinations.length > 0
        ? parsed.data.combinations
        : expandAxes(parsed.data.baseConfig, parsed.data.axes);

    // Validate every generated configuration, every asset reference, the
    // node contract, and all installed selections before queueing the first
    // prompt. ComfyUI itself has no transactional multi-prompt endpoint.
    const validated = await this.jobs.validateBatch(
      expanded.map((variation) => variation.config),
    );
    const submitted: VariationBatchDto["jobs"] = [];
    for (let index = 0; index < validated.length; index += 1) {
      submitted.push({
        label: expanded[index]!.label,
        job: await this.jobs.createValidated(validated[index]!),
      });
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.repository.createGenerationBatch({
      id,
      axes: parsed.data.axes,
      jobs: submitted.map((entry) => ({
        jobId: entry.job.id,
        label: entry.label,
      })),
      createdAt,
    });
    return {
      id,
      axes: parsed.data.axes,
      createdAt,
      jobs: submitted,
    };
  }
}
