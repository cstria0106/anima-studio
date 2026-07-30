import type { GenerationConfig } from "@anima/shared";

import {
  NODE_IDS,
  referenceBatchNodeId,
  referenceLoadNodeId,
  SANITIZED_ANIMA_TEMPLATE,
} from "./template";
import type {
  BuiltWorkflow,
  ComfyLink,
  ComfyPrompt,
  ComfyPromptNode,
  WorkflowBuildOptions,
  WorkflowNodePhase,
} from "./types";

const classes = SANITIZED_ANIMA_TEMPLATE.classTypes;
const MAX_SEED = Number.MAX_SAFE_INTEGER;
const RELATIVE_OUTPUT_PREFIX = /^[^<>:"|?*\u0000-\u001f]+$/;

interface NodeAccumulator {
  prompt: ComfyPrompt;
  phases: Record<string, WorkflowNodePhase>;
  labels: Record<string, string>;
}

function link(nodeId: string, outputIndex: number): ComfyLink {
  return [nodeId, outputIndex];
}

function addNode(
  accumulator: NodeAccumulator,
  nodeId: string,
  classType: string,
  inputs: Record<string, unknown>,
  phase: WorkflowNodePhase,
  label: string,
): void {
  const node: ComfyPromptNode = { class_type: classType, inputs };
  accumulator.prompt[nodeId] = node;
  accumulator.phases[nodeId] = phase;
  accumulator.labels[nodeId] = label;
}

function assertFiniteRange(
  value: number,
  name: string,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

function assertIntegerRange(
  value: number,
  name: string,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function assertPortableSelection(value: string, name: string): void {
  if (!value.trim()) {
    throw new Error(`${name} is required`);
  }

  const normalized = value.replaceAll("\\", "/");
  if (
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${name} must be a ComfyUI-relative name`);
  }
}

function assertOutputPrefix(value: string, name: string): void {
  assertPortableSelection(value, name);
  if (!RELATIVE_OUTPUT_PREFIX.test(value)) {
    throw new Error(`${name} contains unsupported filename characters`);
  }
}

function validateBuildInput(
  config: GenerationConfig,
  uploadedInputNames: string[],
  options: WorkflowBuildOptions,
): void {
  if (uploadedInputNames.length === 0) {
    throw new Error("At least one uploaded reference image is required");
  }
  if (uploadedInputNames.length !== config.referenceAssetIds.length) {
    throw new Error(
      "uploadedInputNames must match config.referenceAssetIds in count and order",
    );
  }

  uploadedInputNames.forEach((name, index) =>
    assertPortableSelection(name, `uploadedInputNames[${index}]`),
  );
  assertPortableSelection(config.model.diffusionModel, "diffusion model");
  assertPortableSelection(config.model.clip, "CLIP model");
  assertPortableSelection(config.model.vae, "VAE");

  if (!["anima", "sdxl"].includes(config.instantLora.profile)) {
    throw new Error("instantLora.profile must be anima or sdxl");
  }

  assertIntegerRange(config.image.width, "image.width", 64, 8192);
  assertIntegerRange(config.image.height, "image.height", 64, 8192);
  if (config.image.width % 8 !== 0 || config.image.height % 8 !== 0) {
    throw new Error("image width and height must be multiples of 8");
  }
  assertIntegerRange(config.image.batchSize, "image.batchSize", 1, 64);

  assertIntegerRange(config.sampling.steps, "sampling.steps", 1, 10000);
  assertFiniteRange(config.sampling.denoise, "sampling.denoise", 0, 1);
  assertFiniteRange(config.sampling.cfg, "sampling.cfg", 0, 100);
  assertFiniteRange(config.sampling.cfgStart, "sampling.cfgStart", 0, 1);
  assertFiniteRange(config.sampling.cfgEnd, "sampling.cfgEnd", 0, 1);
  if (config.sampling.cfgStart > config.sampling.cfgEnd) {
    throw new Error("sampling.cfgStart cannot be greater than sampling.cfgEnd");
  }

  assertIntegerRange(
    config.instantLora.training.steps,
    "instantLora.training.steps",
    0,
    100000,
  );
  assertFiniteRange(
    config.instantLora.training.learningRate,
    "instantLora.training.learningRate",
    0,
    1,
  );
  assertIntegerRange(
    config.instantLora.training.networkDim,
    "instantLora.training.networkDim",
    0,
    1024,
  );
  assertIntegerRange(
    config.instantLora.training.networkAlpha,
    "instantLora.training.networkAlpha",
    0,
    1024,
  );
  assertIntegerRange(
    config.instantLora.training.seed,
    "instantLora.training.seed",
    -1,
    2147483647,
  );
  assertIntegerRange(
    config.instantLora.training.batchSize,
    "instantLora.training.batchSize",
    0,
    256,
  );
  assertFiniteRange(
    config.instantLora.modelStrength,
    "instantLora.modelStrength",
    -10,
    10,
  );
  assertFiniteRange(
    config.instantLora.clipStrength,
    "instantLora.clipStrength",
    -10,
    10,
  );

  assertFiniteRange(
    config.instantLora.tagging.generalThreshold,
    "instantLora.tagging.generalThreshold",
    0,
    1,
  );
  assertFiniteRange(
    config.instantLora.tagging.characterThreshold,
    "instantLora.tagging.characterThreshold",
    0,
    1,
  );

  config.loras.forEach((lora, index) => {
    assertPortableSelection(lora.name, `loras[${index}].name`);
    if (/[<>]/.test(lora.name)) {
      throw new Error(`loras[${index}].name contains unsupported syntax`);
    }
    assertFiniteRange(
      lora.modelStrength,
      `loras[${index}].modelStrength`,
      -10,
      10,
    );
    assertFiniteRange(
      lora.clipStrength,
      `loras[${index}].clipStrength`,
      -10,
      10,
    );
  });

  if (config.upscale.enabled) {
    assertFiniteRange(config.upscale.scale, "upscale.scale", 0.01, 8);
    assertIntegerRange(config.upscale.steps, "upscale.steps", 1, 10000);
    assertFiniteRange(config.upscale.denoise, "upscale.denoise", 0, 1);
  }

  if (config.seed.mode === "fixed") {
    assertIntegerRange(config.seed.value, "seed.value", 0, MAX_SEED);
  }

  assertOutputPrefix(
    options.baseFilenamePrefix ?? "AnimaStudio/base",
    "baseFilenamePrefix",
  );
  assertOutputPrefix(
    options.upscaleFilenamePrefix ?? "AnimaStudio/upscale",
    "upscaleFilenamePrefix",
  );
  assertOutputPrefix(
    options.autoTagsFilenamePrefix ?? "AnimaStudio/tags",
    "autoTagsFilenamePrefix",
  );
}

export function combinePromptSegments(segments: readonly string[]): string {
  return segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("\n");
}

export function createRandomSeed(): number {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  const high = values[0] ?? 0;
  const low = values[1] ?? 0;
  return high * 0x20_0000 + Math.floor(low / 0x800);
}

export function resolveSeed(
  config: GenerationConfig,
  randomSeed: () => number = createRandomSeed,
): number {
  const seed = config.seed.mode === "fixed" ? config.seed.value : randomSeed();
  assertIntegerRange(seed, "resolved seed", 0, MAX_SEED);
  return seed;
}

function buildReferenceNodes(
  accumulator: NodeAccumulator,
  uploadedInputNames: string[],
): ComfyLink {
  const imageLinks = uploadedInputNames.map((image, index) => {
    const nodeId = referenceLoadNodeId(index);
    addNode(
      accumulator,
      nodeId,
      classes.referenceImage,
      { image },
      "training",
      `참조 이미지 ${index + 1}`,
    );
    return link(nodeId, 0);
  });

  let current = imageLinks[0];
  if (!current) {
    throw new Error("At least one reference image is required");
  }

  for (let index = 1; index < imageLinks.length; index += 1) {
    const next = imageLinks[index];
    if (!next) {
      continue;
    }
    const batchNodeId = referenceBatchNodeId(index - 1);
    addNode(
      accumulator,
      batchNodeId,
      classes.referenceBatch,
      { image1: current, image2: next },
      "training",
      `참조 이미지 배치 ${index + 1}`,
    );
    current = link(batchNodeId, 0);
  }

  return current;
}

function formatStrength(value: number): string {
  return String(value);
}

function formatLoraSyntax(
  name: string,
  modelStrength: number,
  clipStrength: number,
): string {
  const model = formatStrength(modelStrength);
  if (Math.abs(modelStrength - clipStrength) <= 0.001) {
    return `<lora:${name}:${model}>`;
  }
  return `<lora:${name}:${model}:${formatStrength(clipStrength)}>`;
}

/**
 * Produces a complete ComfyUI API prompt from validated UI state. It never
 * reads a ComfyUI workflow file or history entry.
 */
export function buildWorkflow(
  config: GenerationConfig,
  uploadedInputNames: string[],
  options: WorkflowBuildOptions = {},
): BuiltWorkflow {
  validateBuildInput(config, uploadedInputNames, options);

  const actualSeed = resolveSeed(config, options.randomSeed);
  const finalPositive = combinePromptSegments([
    config.prompts.basePositive,
    config.prompts.positive,
    config.prompts.natural,
  ]);
  const finalNegative = combinePromptSegments([
    config.prompts.baseNegative,
    config.prompts.negative,
  ]);
  const accumulator: NodeAccumulator = {
    prompt: {},
    phases: {},
    labels: {},
  };

  addNode(
    accumulator,
    NODE_IDS.modelLoader,
    classes.modelLoader,
    {
      unet_name: config.model.diffusionModel,
      weight_dtype: config.model.weightDtype,
    },
    "loading_models",
    "확산 모델 로드",
  );
  addNode(
    accumulator,
    NODE_IDS.clipLoader,
    classes.clipLoader,
    {
      clip_name: config.model.clip,
      type: config.model.clipType,
      device: "default",
    },
    "loading_models",
    "CLIP 로드",
  );
  addNode(
    accumulator,
    NODE_IDS.vaeLoader,
    classes.vaeLoader,
    { vae_name: config.model.vae },
    "loading_models",
    "VAE 로드",
  );

  const referenceImages = buildReferenceNodes(
    accumulator,
    uploadedInputNames,
  );

  const training = config.instantLora.training;
  addNode(
    accumulator,
    NODE_IDS.trainOptions,
    classes.trainOptions,
    {
      steps_override: training.steps,
      learning_rate_override: training.learningRate,
      network_dim_override: training.networkDim,
      network_alpha_override: training.networkAlpha,
      resolution_override: training.resolution,
      gradient_checkpointing: training.gradientCheckpointing,
      cache_latents: training.cacheLatents,
      cache_text_encoder_outputs: training.cacheTextEncoderOutputs,
      seed_override: training.seed,
      force_retrain: training.forceRetrain,
      train_batch_size_override: training.batchSize,
    },
    "training",
    "Instant LoRA 학습 설정",
  );

  const tagging = config.instantLora.tagging;
  addNode(
    accumulator,
    NODE_IDS.taggingOptions,
    classes.taggingOptions,
    {
      general_threshold: tagging.generalThreshold,
      character_threshold: tagging.characterThreshold,
      prepend_tags: tagging.prependTags,
      append_tags: tagging.appendTags,
      exclude_tags: tagging.excludeTags,
      replace_tags: tagging.replaceTags,
      remove_underscore: tagging.removeUnderscore,
    },
    "training",
    "참조 이미지 태깅 설정",
  );

  addNode(
    accumulator,
    NODE_IDS.instantReference,
    classes.instantReference,
    {
      model_strength: config.instantLora.modelStrength,
      clip_strength: config.instantLora.clipStrength,
      profile: config.instantLora.profile,
      model: link(NODE_IDS.modelLoader, 0),
      clip: link(NODE_IDS.clipLoader, 0),
      images: referenceImages,
      vae: link(NODE_IDS.vaeLoader, 0),
      tagging_options: link(NODE_IDS.taggingOptions, 0),
      train_options: link(NODE_IDS.trainOptions, 0),
    },
    "training",
    "참조 태깅 및 Instant LoRA 학습",
  );
  addNode(
    accumulator,
    NODE_IDS.autoTagsSave,
    classes.saveText,
    {
      text: link(NODE_IDS.instantReference, 4),
      filename_prefix:
        options.autoTagsFilenamePrefix ?? "AnimaStudio/tags",
      format: "txt",
    },
    "training",
    "자동 태그 저장",
  );

  const loraValues = config.loras.map((lora) => ({
    name: lora.name,
    strength: formatStrength(lora.modelStrength),
    active: lora.enabled,
    clipStrength: formatStrength(lora.clipStrength),
  }));
  const loraText = config.loras
    .filter((lora) => lora.enabled)
    .map((lora) =>
      formatLoraSyntax(
        lora.name,
        lora.modelStrength,
        lora.clipStrength,
      ),
    )
    .join(" ");

  addNode(
    accumulator,
    NODE_IDS.loraStacker,
    classes.loraStacker,
    {
      text: loraText,
      loras: { __value__: loraValues },
      lora_stack: link(NODE_IDS.instantReference, 3),
    },
    "loading_models",
    "LoRA 스택 구성",
  );
  addNode(
    accumulator,
    NODE_IDS.loraOptimizer,
    classes.loraOptimizer,
    {
      output_strength: 1,
      clip_strength_multiplier: 1,
      model: link(NODE_IDS.modelLoader, 0),
      lora_stack: link(NODE_IDS.loraStacker, 0),
      clip: link(NODE_IDS.clipLoader, 0),
    },
    "loading_models",
    "LoRA 적용",
  );

  addNode(
    accumulator,
    NODE_IDS.positiveEncode,
    classes.textEncode,
    {
      text: finalPositive,
      clip: link(NODE_IDS.loraOptimizer, 1),
    },
    "encoding",
    "긍정 프롬프트 인코딩",
  );
  addNode(
    accumulator,
    NODE_IDS.negativeEncode,
    classes.textEncode,
    {
      text: finalNegative,
      clip: link(NODE_IDS.loraOptimizer, 1),
    },
    "encoding",
    "부정 프롬프트 인코딩",
  );
  addNode(
    accumulator,
    NODE_IDS.cfgGuidance,
    classes.cfgGuidance,
    {
      cfg: config.sampling.cfg,
      start_percent: config.sampling.cfgStart,
      end_percent: config.sampling.cfgEnd,
      model: link(NODE_IDS.loraOptimizer, 0),
      positive: link(NODE_IDS.positiveEncode, 0),
      negative: link(NODE_IDS.negativeEncode, 0),
    },
    "encoding",
    "Scheduled CFG",
  );

  addNode(
    accumulator,
    NODE_IDS.baseNoise,
    classes.noise,
    { noise_seed: actualSeed },
    "sampling",
    "기본 노이즈",
  );
  addNode(
    accumulator,
    NODE_IDS.samplerSelect,
    classes.samplerSelect,
    { sampler_name: config.sampling.sampler },
    "sampling",
    "샘플러 선택",
  );
  addNode(
    accumulator,
    NODE_IDS.baseScheduler,
    classes.scheduler,
    {
      scheduler: config.sampling.scheduler,
      steps: config.sampling.steps,
      denoise: config.sampling.denoise,
      model: link(NODE_IDS.loraOptimizer, 0),
    },
    "sampling",
    "기본 스케줄러",
  );
  addNode(
    accumulator,
    NODE_IDS.emptyLatent,
    classes.emptyLatent,
    {
      width: config.image.width,
      height: config.image.height,
      batch_size: config.image.batchSize,
    },
    "sampling",
    "빈 잠재 이미지",
  );
  addNode(
    accumulator,
    NODE_IDS.baseSampler,
    classes.sampler,
    {
      noise: link(NODE_IDS.baseNoise, 0),
      guider: link(NODE_IDS.cfgGuidance, 0),
      sampler: link(NODE_IDS.samplerSelect, 0),
      sigmas: link(NODE_IDS.baseScheduler, 0),
      latent_image: link(NODE_IDS.emptyLatent, 0),
    },
    "sampling",
    "기본 이미지 샘플링",
  );
  addNode(
    accumulator,
    NODE_IDS.baseDecode,
    classes.decode,
    {
      samples: link(NODE_IDS.baseSampler, 1),
      vae: link(NODE_IDS.vaeLoader, 0),
    },
    "saving",
    "기본 이미지 디코드",
  );
  addNode(
    accumulator,
    NODE_IDS.baseSave,
    classes.saveImage,
    {
      filename_prefix:
        options.baseFilenamePrefix ?? "AnimaStudio/base",
      images: link(NODE_IDS.baseDecode, 0),
    },
    "saving",
    "기본 이미지 저장",
  );

  const outputKinds: Record<string, "base" | "upscale"> = {
    [NODE_IDS.baseSave]: "base",
  };
  const outputNodeIds: BuiltWorkflow["outputNodeIds"] = {
    base: NODE_IDS.baseSave,
  };

  if (config.upscale.enabled) {
    addNode(
      accumulator,
      NODE_IDS.upscaleLatent,
      classes.latentUpscale,
      {
        upscale_method: config.upscale.method,
        scale_by: config.upscale.scale,
        samples: link(NODE_IDS.baseSampler, 1),
      },
      "upscaling",
      "잠재 이미지 업스케일",
    );
    addNode(
      accumulator,
      NODE_IDS.upscaleNoise,
      classes.noise,
      { noise_seed: actualSeed },
      "upscaling",
      "업스케일 노이즈",
    );
    addNode(
      accumulator,
      NODE_IDS.upscaleScheduler,
      classes.scheduler,
      {
        scheduler: config.sampling.scheduler,
        steps: config.upscale.steps,
        denoise: config.upscale.denoise,
        model: link(NODE_IDS.loraOptimizer, 0),
      },
      "upscaling",
      "업스케일 스케줄러",
    );
    addNode(
      accumulator,
      NODE_IDS.upscaleSampler,
      classes.sampler,
      {
        noise: link(NODE_IDS.upscaleNoise, 0),
        guider: link(NODE_IDS.cfgGuidance, 0),
        sampler: link(NODE_IDS.samplerSelect, 0),
        sigmas: link(NODE_IDS.upscaleScheduler, 0),
        latent_image: link(NODE_IDS.upscaleLatent, 0),
      },
      "upscaling",
      "업스케일 샘플링",
    );
    addNode(
      accumulator,
      NODE_IDS.upscaleDecode,
      classes.decode,
      {
        samples: link(NODE_IDS.upscaleSampler, 1),
        vae: link(NODE_IDS.vaeLoader, 0),
      },
      "upscaling",
      "업스케일 이미지 디코드",
    );
    addNode(
      accumulator,
      NODE_IDS.upscaleSave,
      classes.saveImage,
      {
        filename_prefix:
          options.upscaleFilenamePrefix ?? "AnimaStudio/upscale",
        images: link(NODE_IDS.upscaleDecode, 0),
      },
      "saving",
      "업스케일 이미지 저장",
    );
    outputKinds[NODE_IDS.upscaleSave] = "upscale";
    outputNodeIds.upscale = NODE_IDS.upscaleSave;
  }

  return {
    prompt: accumulator.prompt,
    actualSeed,
    finalPositive,
    finalNegative,
    nodePhases: accumulator.phases,
    nodeLabels: accumulator.labels,
    outputKinds,
    outputNodeIds,
    autoTagsNodeId: NODE_IDS.autoTagsSave,
    autoTagsSource: link(NODE_IDS.instantReference, 4),
  };
}

/**
 * Builds only the latent-upscale sampling branch from an already generated
 * base image. Model, prompt and LoRA conditioning are rebuilt from the saved
 * job snapshot, but the base sampler is never run again.
 */
export function buildUpscaleWorkflow(
  config: GenerationConfig,
  uploadedInputNames: string[],
  baseImageInputName: string,
  options: WorkflowBuildOptions = {},
): BuiltWorkflow {
  assertPortableSelection(baseImageInputName, "baseImageInputName");
  if (!config.upscale.enabled) {
    throw new Error("upscale must be enabled for an upscale-only workflow");
  }

  const built = buildWorkflow(config, uploadedInputNames, options);
  addNode(
    {
      prompt: built.prompt,
      phases: built.nodePhases,
      labels: built.nodeLabels,
    },
    NODE_IDS.upscaleSourceLoad,
    classes.referenceImage,
    { image: baseImageInputName },
    "upscaling",
    "기본 결과 이미지 로드",
  );
  addNode(
    {
      prompt: built.prompt,
      phases: built.nodePhases,
      labels: built.nodeLabels,
    },
    NODE_IDS.upscaleSourceEncode,
    classes.encode,
    {
      pixels: link(NODE_IDS.upscaleSourceLoad, 0),
      vae: link(NODE_IDS.vaeLoader, 0),
    },
    "upscaling",
    "기본 결과 잠재 이미지 인코드",
  );

  const upscaleLatent = built.prompt[NODE_IDS.upscaleLatent];
  if (!upscaleLatent) {
    throw new Error("upscale workflow branch was not constructed");
  }
  upscaleLatent.inputs.samples = link(NODE_IDS.upscaleSourceEncode, 0);

  for (const nodeId of [
    NODE_IDS.baseNoise,
    NODE_IDS.baseScheduler,
    NODE_IDS.emptyLatent,
    NODE_IDS.baseSampler,
    NODE_IDS.baseDecode,
    NODE_IDS.baseSave,
  ]) {
    delete built.prompt[nodeId];
    delete built.nodePhases[nodeId];
    delete built.nodeLabels[nodeId];
    delete built.outputKinds[nodeId];
  }
  delete built.outputNodeIds.base;

  return built;
}
