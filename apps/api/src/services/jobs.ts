import type {
  ComfyOptions,
  GenerationConfig,
  JobDto,
  JobStatus,
} from "@anima/shared";
import {
  generationConfigSchema,
  upscaleJobRequestSchema,
} from "@anima/shared";
import { resolveSeed } from "@anima/workflow";
import type { ComfyClientLike } from "../comfy/client";
import { ComfyHttpError } from "../comfy/client";
import type { JobListQuery } from "../db/repository";
import { StudioRepository } from "../db/repository";
import type { AssetRow } from "../db/schema";
import { FileStorage } from "../files/storage";
import type {
  WorkflowBuildResult,
  WorkflowEngine,
} from "../workflow/engine";
import { CapabilityService } from "./capabilities";
import { JobEventService } from "./job-events";

export class JobSubmissionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "JobSubmissionError";
  }
}

export interface JobListResult {
  jobs: JobDto[];
  nextCursor: string | null;
}

export interface ValidatedGeneration {
  config: GenerationConfig;
  assetRows: AssetRow[];
}

function hasPrompt(
  tuples: ArrayLike<unknown[]>,
  promptId: string,
): boolean {
  return Array.from(tuples).some((tuple) => tuple[1] === promptId);
}

function assertInstalled(
  selected: string,
  installed: string[],
  label: string,
): void {
  if (!installed.includes(selected)) {
    throw new JobSubmissionError(
      `${label} is not installed in the connected ComfyUI: ${selected}`,
      422,
      { kind: "model", selected, installed },
    );
  }
}

function validateInstalledSelections(
  config: GenerationConfig,
  options: ComfyOptions,
): void {
  assertInstalled(
    config.model.diffusionModel,
    options.diffusionModels,
    "Diffusion model",
  );
  assertInstalled(config.model.clip, options.clips, "CLIP model");
  assertInstalled(config.model.vae, options.vaes, "VAE");
  assertInstalled(config.sampling.sampler, options.samplers, "Sampler");
  assertInstalled(config.sampling.scheduler, options.schedulers, "Scheduler");
  for (const lora of config.loras) {
    if (lora.enabled) assertInstalled(lora.name, options.loras, "LoRA");
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ComfyHttpError) {
    if (
      error.body &&
      typeof error.body === "object" &&
      "error" in error.body
    ) {
      const bodyError = (error.body as { error?: unknown }).error;
      if (bodyError && typeof bodyError === "object" && "message" in bodyError) {
        return `${error.message} ${String((bodyError as { message: unknown }).message)}`;
      }
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class JobService {
  private onSubmitted: ((jobId: string) => void | Promise<void>) | null = null;

  constructor(
    private readonly repository: StudioRepository,
    private readonly storage: FileStorage,
    private readonly comfy: ComfyClientLike,
    private readonly workflow: WorkflowEngine,
    private readonly capabilities: CapabilityService,
    private readonly events: JobEventService,
    private readonly clientId: string,
  ) {}

  setSubmissionListener(
    listener: (jobId: string) => void | Promise<void>,
  ): void {
    this.onSubmitted = listener;
  }

  private async submitCreatedJob(input: {
    jobId: string;
    config: GenerationConfig;
    actualSeed: number;
    assetRows: AssetRow[];
    build: (
      uploadedInputNames: string[],
    ) => WorkflowBuildResult | Promise<WorkflowBuildResult>;
    extraData?: Record<string, unknown>;
  }): Promise<JobDto> {
    const {
      jobId,
      config,
      actualSeed,
      assetRows,
      build,
      extraData = {},
    } = input;
    try {
      this.repository.updateJob(jobId, {
        status: "uploading",
        phase: "uploading",
      });
      const inputNames: string[] = [];
      for (let index = 0; index < assetRows.length; index += 1) {
        const asset = assetRows[index]!;
        const upload = await this.storage.uploadAssetToComfy(asset, this.comfy);
        inputNames.push(upload.inputName);
        const current = index + 1;
        this.events.append({
          jobId,
          phase: "uploading",
          message: `참조 이미지 ${current}/${assetRows.length} 업로드`,
          current,
          total: assetRows.length,
          progress: Math.round((current / assetRows.length) * 100),
        });
      }

      const built = await build(inputNames);
      if (built.actualSeed !== actualSeed) {
        throw new JobSubmissionError(
          "Workflow seed did not match the persisted job seed.",
          500,
        );
      }
      this.repository.updateJob(jobId, {
        workflow: built.prompt,
        nodePhases: built.nodePhases,
        nodeLabels: built.nodeLabels,
        outputKinds: built.outputKinds,
        autoTagsNodeId: built.autoTagsNodeId,
      });
      this.events.append({
        jobId,
        phase: "queued",
        message: "ComfyUI 실행 프롬프트를 구성했습니다.",
        progress: null,
      });

      const queued = await this.comfy.queuePrompt(
        built.prompt,
        this.clientId,
        {
          // ComfyUI defaults to no latent previews unless started with a
          // preview CLI flag. Override it per prompt so the Studio preview
          // works on a standard installation.
          preview_method: "latent2rgb",
          animaStudio: {
            jobId,
            schemaVersion: 1,
            ...extraData,
          },
        },
      );
      if (!queued.prompt_id) {
        throw new JobSubmissionError(
          "ComfyUI did not return a prompt ID.",
          502,
          queued,
        );
      }
      const queueNumber =
        typeof queued.number === "number" && Number.isFinite(queued.number)
          ? Math.trunc(queued.number)
          : null;
      this.repository.updateJob(jobId, {
        status: "queued",
        phase: "queued",
        comfyPromptId: queued.prompt_id,
        queueNumber,
      });
      this.events.append({
        jobId,
        phase: "queued",
        message:
          queueNumber === null
            ? "ComfyUI 대기열에 추가했습니다."
            : `ComfyUI 대기열 #${queueNumber}에 추가했습니다.`,
        progress: null,
        payload: { promptId: queued.prompt_id, queueNumber },
      });
      await this.onSubmitted?.(jobId);
      return this.repository.findJob(jobId)!;
    } catch (error) {
      const message = errorMessage(error);
      this.repository.updateJob(jobId, {
        status: "failed",
        phase: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      });
      this.events.append({
        jobId,
        phase: "failed",
        message,
        progress: null,
      });
      if (error instanceof JobSubmissionError) throw error;
      throw new JobSubmissionError(message, 502);
    }
  }

  async validateBatch(
    rawConfigs: readonly unknown[],
  ): Promise<ValidatedGeneration[]> {
    if (rawConfigs.length === 0) {
      throw new JobSubmissionError(
        "At least one generation setting is required.",
        422,
      );
    }
    const validated = rawConfigs.map((rawConfig, index) => {
      const parsed = generationConfigSchema.safeParse(rawConfig);
      if (!parsed.success) {
        throw new JobSubmissionError(
          "Generation settings are invalid.",
          422,
          { index, validation: parsed.error.flatten() },
        );
      }
      const config = parsed.data;
      if (
        new Set(config.referenceAssetIds).size !==
        config.referenceAssetIds.length
      ) {
        throw new JobSubmissionError(
          "Reference images may only be selected once per job.",
          422,
          { index },
        );
      }
      const assetRows = this.repository.findAssets(config.referenceAssetIds);
      if (assetRows.length !== config.referenceAssetIds.length) {
        const found = new Set(assetRows.map((asset) => asset.id));
        throw new JobSubmissionError(
          "One or more reference assets do not exist.",
          422,
          {
            index,
            missingAssetIds: config.referenceAssetIds.filter(
              (id) => !found.has(id),
            ),
          },
        );
      }
      return { config, assetRows };
    });
    const report = await this.capabilities.report();
    if (!report.compatible) {
      throw new JobSubmissionError(
        "The connected ComfyUI is missing required nodes or has incompatible node contracts.",
        409,
        report,
      );
    }
    const options = await this.capabilities.options();
    for (let index = 0; index < validated.length; index += 1) {
      const item = validated[index]!;
      validateInstalledSelections(item.config, options);
      try {
        const preflightInputs = item.assetRows.map(
          (_asset, assetIndex) =>
            `anima-studio/preflight-${index}-${assetIndex}.png`,
        );
        const seed =
          item.config.seed.mode === "fixed" ? item.config.seed.value : 0;
        this.workflow.build(item.config, preflightInputs, seed);
      } catch (error) {
        throw new JobSubmissionError(
          "Generation workflow settings are invalid.",
          422,
          { index, message: errorMessage(error) },
        );
      }
    }
    return validated;
  }

  async createValidated(
    validated: ValidatedGeneration,
  ): Promise<JobDto> {
    const { config, assetRows } = validated;
    const actualSeed = resolveSeed(config);
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.repository.createJob({
      id: jobId,
      clientId: this.clientId,
      config,
      actualSeed,
      assetIds: config.referenceAssetIds,
      createdAt,
    });
    this.events.append({
      jobId,
      phase: "preparing",
      message: "작업 설정을 확인했습니다.",
      progress: 0,
    });

    return this.submitCreatedJob({
      jobId,
      config,
      actualSeed,
      assetRows,
      build: (inputNames) =>
        this.workflow.build(config, inputNames, actualSeed),
    });
  }

  async create(rawConfig: unknown): Promise<JobDto> {
    const [validated] = await this.validateBatch([rawConfig]);
    return this.createValidated(validated!);
  }

  async upscale(sourceJobId: string, rawRequest: unknown): Promise<JobDto> {
    const parsedRequest = upscaleJobRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      throw new JobSubmissionError(
        "Upscale settings are invalid.",
        422,
        parsedRequest.error.flatten(),
      );
    }
    const source = this.repository.findJobRow(sourceJobId);
    if (!source) throw new JobSubmissionError("Job not found.", 404);
    if (source.status !== "completed") {
      throw new JobSubmissionError(
        "Only a completed base generation can be upscaled.",
        409,
      );
    }
    const sourceJob = this.repository.toJobDto(source);
    if (sourceJob.config.upscale.enabled) {
      throw new JobSubmissionError(
        "This job already requested an upscale during generation.",
        409,
      );
    }
    if (sourceJob.outputs.some((output) => output.kind === "upscale")) {
      throw new JobSubmissionError(
        "This job already contains an upscale output.",
        409,
      );
    }

    const baseOutputs = this.repository
      .listOutputs(sourceJobId)
      .filter((output) => output.kind === "base");
    const sourceOutput = parsedRequest.data.outputId
      ? baseOutputs.find(
          (output) => output.id === parsedRequest.data.outputId,
        )
      : baseOutputs[0];
    if (!sourceOutput) {
      throw new JobSubmissionError(
        parsedRequest.data.outputId
          ? "The selected base output does not belong to this job."
          : "The completed job has no preserved base image.",
        422,
      );
    }

    const config = generationConfigSchema.parse({
      ...sourceJob.config,
      seed: { mode: "fixed", value: source.actualSeed },
      instantLora: {
        ...sourceJob.config.instantLora,
        training: {
          ...sourceJob.config.instantLora.training,
          // Allow InstantReference to reuse its cache for the identical
          // references/settings instead of forcing a second training run.
          forceRetrain: false,
        },
      },
      upscale: {
        ...sourceJob.config.upscale,
        ...parsedRequest.data.upscale,
        enabled: true,
      },
    });

    const report = await this.capabilities.report();
    if (!report.compatible) {
      throw new JobSubmissionError(
        "The connected ComfyUI is missing required nodes or has incompatible node contracts.",
        409,
        report,
      );
    }
    validateInstalledSelections(config, await this.capabilities.options());

    const assetRows = this.repository.getJobAssets(sourceJobId);
    if (assetRows.length !== config.referenceAssetIds.length) {
      throw new JobSubmissionError(
        "One or more original reference assets are unavailable.",
        409,
      );
    }
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.repository.createJob({
      id: jobId,
      kind: "upscale",
      parentJobId: sourceJobId,
      sourceOutputId: sourceOutput.id,
      clientId: this.clientId,
      config,
      actualSeed: source.actualSeed,
      assetIds: assetRows.map((asset) => asset.id),
      createdAt,
    });
    this.repository.updateJob(jobId, { autoTags: source.autoTags });
    this.events.append({
      jobId,
      phase: "preparing",
      message: "기존 기본 결과와 원본 실행 설정을 확인했습니다.",
      progress: 0,
      payload: {
        parentJobId: sourceJobId,
        sourceOutputId: sourceOutput.id,
        actualSeed: source.actualSeed,
      },
    });

    return this.submitCreatedJob({
      jobId,
      config,
      actualSeed: source.actualSeed,
      assetRows,
      build: async (inputNames) => {
        const uploadedBase = await this.storage.uploadOutputToComfy(
          sourceOutput,
          this.comfy,
        );
        this.events.append({
          jobId,
          phase: "uploading",
          message: "기존 기본 결과 이미지를 업스케일 입력으로 업로드했습니다.",
          progress: 100,
        });
        return this.workflow.buildUpscale(
          config,
          inputNames,
          uploadedBase.inputName,
          source.actualSeed,
        );
      },
      extraData: {
        kind: "upscale",
        parentJobId: sourceJobId,
        sourceOutputId: sourceOutput.id,
      },
    });
  }

  get(id: string): JobDto {
    const job = this.repository.findJob(id);
    if (!job) throw new JobSubmissionError("Job not found.", 404);
    return job;
  }

  list(query: JobListQuery): JobListResult {
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const rows = this.repository.listJobRows({ ...query, limit });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      jobs: page.map((row) => this.repository.toJobDto(row)),
      nextCursor:
        hasMore && page.length > 0 ? (page.at(-1)?.createdAt ?? null) : null,
    };
  }

  async cancel(id: string): Promise<JobDto> {
    const row = this.repository.findJobRow(id);
    if (!row) throw new JobSubmissionError("Job not found.", 404);
    if (this.repository.isTerminal(row)) {
      throw new JobSubmissionError(
        `A ${row.status} job cannot be cancelled.`,
        409,
      );
    }

    if (row.comfyPromptId) {
      const queue = await this.comfy.getQueue();
      if (hasPrompt(queue.queue_pending, row.comfyPromptId)) {
        await this.comfy.cancelQueued(row.comfyPromptId);
      } else if (hasPrompt(queue.queue_running, row.comfyPromptId)) {
        await this.comfy.interrupt();
      } else {
        const history = await this.comfy.getHistory(row.comfyPromptId);
        if (history[row.comfyPromptId]) {
          throw new JobSubmissionError(
            "The job has already left the ComfyUI queue and is being finalized.",
            409,
          );
        }
      }
    }

    this.repository.updateJob(id, {
      status: "cancelled",
      phase: "cancelled",
      queueNumber: null,
      completedAt: new Date().toISOString(),
    });
    this.events.append({
      jobId: id,
      phase: "cancelled",
      message: "작업을 취소했습니다.",
      progress: null,
    });
    return this.repository.findJob(id)!;
  }

  statuses(): readonly JobStatus[] {
    return [
      "draft",
      "uploading",
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];
  }
}
