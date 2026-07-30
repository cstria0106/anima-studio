import type { Context } from "hono";
import { CivitaiError } from "../civitai/errors";
import { HuggingFaceError } from "../huggingface/errors";
import { ComfyHttpError } from "../comfy/client";
import { FileValidationError } from "../files/storage";
import { JobSubmissionError } from "../services/jobs";
import {
  RuntimeBusyError,
  RuntimeOwnershipError,
} from "../runtime/supervisor";
import {
  RuntimeInstallInProgressError,
  RuntimePreflightError,
} from "../runtime/installer";

export interface ErrorBody {
  message: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class RuntimeRequestError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RuntimeRequestError";
  }
}

export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof HuggingFaceError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies ErrorBody,
      error.status as 400,
    );
  }
  if (error instanceof CivitaiError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies ErrorBody,
      error.status as 400,
    );
  }
  if (error instanceof JobSubmissionError) {
    const body: ErrorBody = {
      message: error.message,
      error: {
        code: "JOB_ERROR",
        message: error.message,
      },
    };
    if (error.details !== undefined) body.error.details = error.details;
    return c.json(body, error.status as 400);
  }
  if (error instanceof RuntimePreflightError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: "RUNTIME_PREFLIGHT_FAILED",
          message: error.message,
          details: error.preflight,
        },
      } satisfies ErrorBody,
      400,
    );
  }
  if (error instanceof RuntimeBusyError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: "RUNTIME_BUSY",
          message: error.message,
          details: { activeJobs: error.activeJobs },
        },
      } satisfies ErrorBody,
      409,
    );
  }
  if (
    error instanceof RuntimeOwnershipError ||
    error instanceof RuntimeInstallInProgressError
  ) {
    return c.json(
      {
        message: error.message,
        error: {
          code:
            error instanceof RuntimeOwnershipError
              ? "RUNTIME_OWNERSHIP_MISMATCH"
              : "RUNTIME_OPERATION_ACTIVE",
          message: error.message,
        },
      } satisfies ErrorBody,
      409,
    );
  }
  if (error instanceof RuntimeRequestError) {
    const body: ErrorBody = {
      message: error.message,
      error: {
        code: "RUNTIME_ERROR",
        message: error.message,
      },
    };
    if (error.details !== undefined) body.error.details = error.details;
    return c.json(body, error.status as 400);
  }
  if (error instanceof FileValidationError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: "FILE_ERROR",
          message: error.message,
        },
      } satisfies ErrorBody,
      error.status as 400,
    );
  }
  if (error instanceof ComfyHttpError) {
    return c.json(
      {
        message: error.message,
        error: {
          code: "COMFY_ERROR",
          message: error.message,
        },
      } satisfies ErrorBody,
      502,
    );
  }
  console.error(error);
  return c.json(
    {
      message: "An unexpected server error occurred.",
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected server error occurred.",
      },
    } satisfies ErrorBody,
    500,
  );
}
