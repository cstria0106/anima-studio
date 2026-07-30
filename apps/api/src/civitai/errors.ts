export type CivitaiErrorCode =
  | "INVALID_URL"
  | "INVALID_MODEL"
  | "INVALID_VERSION"
  | "INVALID_FILE"
  | "UNSUPPORTED_MODEL"
  | "UNSUPPORTED_FILE"
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "REMOTE_UNAVAILABLE"
  | "INCOMPATIBLE_LORA_MANAGER"
  | "INVALID_DESTINATION"
  | "DOWNLOAD_FAILED"
  | "DOWNLOAD_NOT_FOUND"
  | "HASH_MISMATCH";

/**
 * An error safe to serialize to an API caller.
 *
 * Remote response bodies and request headers are intentionally never attached
 * to this error. In particular, Civitai tokens must not become part of an
 * error, log record, or JSON response.
 */
export class CivitaiError extends Error {
  constructor(
    readonly code: CivitaiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CivitaiError";
  }
}

export function assertCivitai(
  condition: unknown,
  code: CivitaiErrorCode,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new CivitaiError(code, message, status);
}
