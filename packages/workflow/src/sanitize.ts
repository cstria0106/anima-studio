import type { PortabilityViolation } from "./types";

const FORBIDDEN_KEYS = new Set([
  "client_id",
  "prompt_id",
  "workflow",
  "workflow_id",
  "extra_pnginfo",
  "clipspace",
  "__lm_autocomplete_meta_text",
]);

const ABSOLUTE_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z]:[\\/](?:Users|home)[\\/]/i, "Windows user path"],
  [/\/(?:Users|home)\/[^/]+/i, "user home path"],
  [/file:\/\//i, "file URL"],
];

/**
 * Recursively verifies that a persisted workflow blueprint does not contain
 * transient ComfyUI metadata or machine/user-local paths.
 */
export function findPortabilityViolations(
  value: unknown,
  path = "$",
): PortabilityViolation[] {
  if (typeof value === "string") {
    return ABSOLUTE_PATH_PATTERNS.flatMap(([pattern, reason]) =>
      pattern.test(value) ? [{ path, reason }] : [],
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findPortabilityViolations(entry, `${path}[${index}]`),
    );
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    const ownViolation = FORBIDDEN_KEYS.has(key.toLowerCase())
      ? [{ path: entryPath, reason: "transient ComfyUI metadata" }]
      : [];
    return [...ownViolation, ...findPortabilityViolations(entry, entryPath)];
  });
}

export function assertPortableTemplate(value: unknown): void {
  const violations = findPortabilityViolations(value);
  if (violations.length === 0) {
    return;
  }

  const details = violations
    .map((violation) => `${violation.path}: ${violation.reason}`)
    .join(", ");
  throw new Error(`Workflow template is not portable: ${details}`);
}
