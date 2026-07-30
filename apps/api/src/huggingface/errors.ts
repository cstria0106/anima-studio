export type HuggingFaceErrorCode =
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_INCOMPATIBLE"
  | "INVALID_REVISION"
  | "INVALID_FILE"
  | "LICENSE_REQUIRED"
  | "DOWNLOAD_NOT_FOUND"
  | "DOWNLOAD_CONFLICT"
  | "DOWNLOAD_FAILED";

export class HuggingFaceError extends Error {
  constructor(
    readonly code: HuggingFaceErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HuggingFaceError";
  }
}

export function assertHuggingFace(
  condition: unknown,
  code: HuggingFaceErrorCode,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new HuggingFaceError(code, message, status);
}
