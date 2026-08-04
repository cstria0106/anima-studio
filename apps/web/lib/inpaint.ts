import type {
  GenerationDraft,
  JobOutput,
  ReferenceAsset,
  StudioJob,
} from "./types";

export interface InpaintCrop {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  x: number;
  y: number;
  cropped: boolean;
}

export type InpaintWorkspaceSource =
  | {
      type: "asset";
      asset: ReferenceAsset;
      crop: InpaintCrop;
    }
  | {
      type: "output";
      job: StudioJob;
      output: JobOutput;
      crop: InpaintCrop;
    };

export interface InpaintWorkspaceDraft {
  source: InpaintWorkspaceSource | null;
  sourceStatus: "idle" | "preparing" | "uploading" | "ready" | "error";
  sourceError?: string;
  maskAsset: ReferenceAsset | null;
  growMaskBy: number;
  revisionOfJobId?: string;
}

export function emptyInpaintWorkspace(): InpaintWorkspaceDraft {
  return {
    source: null,
    sourceStatus: "idle",
    maskAsset: null,
    growMaskBy: 6,
  };
}

export function inpaintWorkspaceFromOutput(
  job: StudioJob,
  output: JobOutput,
): InpaintWorkspaceDraft {
  const width = output.width ?? job.settings.sampling.width;
  const height = output.height ?? job.settings.sampling.height;
  return {
    source: {
      type: "output",
      job,
      output,
      crop: centeredInpaintCrop(width, height),
    },
    sourceStatus: "ready",
    maskAsset: job.inpaint?.maskAsset ?? null,
    growMaskBy: job.inpaint?.growMaskBy ?? 6,
    revisionOfJobId:
      job.kind === "inpaint" && job.inpaint ? job.id : undefined,
  };
}

export function preparedInpaintSubmission(value: InpaintWorkspaceDraft) {
  if (
    value.sourceStatus !== "ready" ||
    !value.source ||
    !value.maskAsset
  ) {
    throw new Error("인페인트 원본과 저장된 마스크를 확인해주세요.");
  }
  return {
    source:
      value.source.type === "asset"
        ? { type: "asset" as const, assetId: value.source.asset.id }
        : { type: "output" as const, outputId: value.source.output.id },
    maskAssetId: value.maskAsset.id,
    growMaskBy: value.growMaskBy,
    revisionOfJobId: value.revisionOfJobId,
  };
}

export function centeredInpaintCrop(
  sourceWidth: number,
  sourceHeight: number,
): InpaintCrop {
  const width = Math.floor(sourceWidth / 8) * 8;
  const height = Math.floor(sourceHeight / 8) * 8;
  return {
    sourceWidth,
    sourceHeight,
    width,
    height,
    x: Math.floor((sourceWidth - width) / 2),
    y: Math.floor((sourceHeight - height) / 2),
    cropped: width !== sourceWidth || height !== sourceHeight,
  };
}

export interface MaskHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export type MaskHistoryAction<T> =
  | { type: "commit"; value: T }
  | { type: "undo" }
  | { type: "redo" };

export function reduceMaskHistory<T>(
  state: MaskHistory<T>,
  action: MaskHistoryAction<T>,
): MaskHistory<T> {
  if (action.type === "commit") {
    return {
      past: [...state.past, state.present].slice(-30),
      present: action.value,
      future: [],
    };
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (previous === undefined) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    };
  }
  const next = state.future[0];
  if (next === undefined) return state;
  return {
    past: [...state.past, state.present].slice(-30),
    present: next,
    future: state.future.slice(1),
  };
}

export function maskHasPaint(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) return true;
  }
  return false;
}

export function initialInpaintDraft(
  currentDraft: GenerationDraft,
  sourceJob?: StudioJob,
): GenerationDraft {
  const draft = structuredClone(sourceJob?.settings ?? currentDraft);
  draft.upscale.enabled = false;
  return draft;
}
