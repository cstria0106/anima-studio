export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyPrompt = Record<string, WorkflowNode>;

export interface ComfyObjectInfoEntry {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
    hidden?: Record<string, unknown>;
  };
  input_order?: Record<string, string[]>;
  output?: unknown[];
  output_name?: string[];
  name?: string;
  display_name?: string;
  description?: string;
  category?: string;
}

export type ComfyObjectInfo = Record<string, ComfyObjectInfoEntry>;

export interface ComfyQueueTuple extends Array<unknown> {
  0: number;
  1: string;
}

export interface ComfyQueue {
  queue_running: ComfyQueueTuple[];
  queue_pending: ComfyQueueTuple[];
}

export interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistoryEntry {
  prompt?: unknown[];
  outputs?: Record<
    string,
    {
      images?: ComfyImageRef[];
      gifs?: ComfyImageRef[];
      text?: string[] | string;
      [key: string]: unknown;
    }
  >;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  [key: string]: unknown;
}

export type ComfyHistory = Record<string, ComfyHistoryEntry>;

export interface ComfySocketEvent {
  type: string;
  data?: {
    prompt_id?: string;
    node?: string | null;
    value?: number;
    max?: number;
    exception_message?: string;
    exception_type?: string;
    traceback?: string[];
    output?: unknown;
    [key: string]: unknown;
  };
}

export interface ComfyPreviewFrame {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  promptId: string | null;
  nodeId: string | null;
  step: number | null;
  total: number | null;
}
