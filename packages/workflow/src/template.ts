/**
 * This is the only static workflow blueprint in the package. It deliberately
 * contains no selected model, LoRA, input filename, prompt, client id, or
 * ComfyUI workflow/history metadata. The builder injects all environment
 * selections at job submission time.
 */
export const SANITIZED_ANIMA_TEMPLATE = Object.freeze({
  id: "portable-anima-instant-reference",
  schemaVersion: 1,
  profile: "anima",
  defaults: Object.freeze({
    instantReference: Object.freeze({
      modelStrength: 0.7,
      clipStrength: 0.7,
      trainingSteps: 200,
      learningRate: 0.001,
      networkDimension: 16,
      networkAlpha: 1,
    }),
    sampling: Object.freeze({
      cfg: 5,
      steps: 30,
      sampler: "er_sde",
      scheduler: "sgm_uniform",
      denoise: 1,
    }),
    image: Object.freeze({
      width: 704,
      height: 1408,
      batchSize: 1,
    }),
    upscale: Object.freeze({
      method: "bilinear",
      scale: 1.5,
      steps: 30,
      denoise: 0.7,
    }),
  }),
  classTypes: Object.freeze({
    modelLoader: "UNETLoader",
    clipLoader: "CLIPLoader",
    vaeLoader: "VAELoader",
    referenceImage: "LoadImage",
    referenceBatch: "ImageBatch",
    trainOptions: "ReferenceTrainOptions",
    taggingOptions: "ReferenceTaggingOptions",
    instantReference: "InstantReferenceLoRA",
    loraStacker: "Lora Stacker (LoraManager)",
    loraOptimizer: "LoRAOptimizerSimple",
    textEncode: "CLIPTextEncode",
    cfgGuidance: "ScheduledCFGGuidance",
    noise: "RandomNoise",
    samplerSelect: "KSamplerSelect",
    scheduler: "BasicScheduler",
    emptyLatent: "EmptyLatentImage",
    sampler: "SamplerCustomAdvanced",
    latentUpscale: "LatentUpscaleBy",
    encode: "VAEEncode",
    decode: "VAEDecode",
    saveImage: "SaveImage",
    saveText: "SaveText",
  }),
});

export const NODE_IDS = Object.freeze({
  modelLoader: "1",
  clipLoader: "2",
  vaeLoader: "3",
  trainOptions: "4",
  taggingOptions: "5",
  instantReference: "6",
  loraStacker: "7",
  loraOptimizer: "8",
  positiveEncode: "9",
  negativeEncode: "10",
  cfgGuidance: "11",
  baseNoise: "12",
  samplerSelect: "13",
  baseScheduler: "14",
  emptyLatent: "15",
  baseSampler: "16",
  baseDecode: "17",
  baseSave: "18",
  autoTagsSave: "19",
  upscaleLatent: "20",
  upscaleNoise: "21",
  upscaleScheduler: "22",
  upscaleSampler: "23",
  upscaleDecode: "24",
  upscaleSave: "25",
  upscaleSourceLoad: "26",
  upscaleSourceEncode: "27",
});

const REFERENCE_LOAD_NODE_START = 1000;
const REFERENCE_BATCH_NODE_START = 2000;

export function referenceLoadNodeId(index: number): string {
  return String(REFERENCE_LOAD_NODE_START + index);
}

export function referenceBatchNodeId(index: number): string {
  return String(REFERENCE_BATCH_NODE_START + index);
}
