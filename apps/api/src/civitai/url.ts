import { CivitaiError, assertCivitai } from "./errors";
import {
  CIVITAI_PAGE_HOSTS,
  type CivitaiModelReference,
  type CivitaiPageHost,
} from "./types";

const maximumUrlLength = 2_048;
const positiveInteger = /^[1-9]\d*$/;
const modelPath = /^\/models\/([1-9]\d*)(?:\/[^/?#]+)?\/?$/;

function parseSafePositiveInteger(
  value: string,
  field: "model ID" | "model version ID",
): number {
  assertCivitai(
    positiveInteger.test(value),
    field === "model ID" ? "INVALID_MODEL" : "INVALID_VERSION",
    `Civitai ${field} must be a positive integer.`,
  );
  const parsed = Number(value);
  assertCivitai(
    Number.isSafeInteger(parsed) && parsed > 0,
    field === "model ID" ? "INVALID_MODEL" : "INVALID_VERSION",
    `Civitai ${field} is outside the supported range.`,
  );
  return parsed;
}

function isPageHost(value: string): value is CivitaiPageHost {
  return (CIVITAI_PAGE_HOSTS as readonly string[]).includes(value);
}

/**
 * Parse only public Civitai model-page URLs. API, download, image and arbitrary
 * subdomain URLs are deliberately rejected at this boundary.
 */
export function parseCivitaiModelUrl(input: string): CivitaiModelReference {
  const value = input.trim();
  assertCivitai(
    value.length > 0 && value.length <= maximumUrlLength,
    "INVALID_URL",
    "Enter a valid Civitai model URL.",
  );

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CivitaiError(
      "INVALID_URL",
      "Enter a valid Civitai model URL.",
      400,
    );
  }

  assertCivitai(
    url.protocol === "https:",
    "INVALID_URL",
    "Civitai URLs must use HTTPS.",
  );
  assertCivitai(
    !url.username && !url.password,
    "INVALID_URL",
    "Civitai URLs cannot contain credentials.",
  );
  assertCivitai(
    !url.port || url.port === "443",
    "INVALID_URL",
    "Civitai URLs cannot use a custom port.",
  );
  assertCivitai(
    isPageHost(url.hostname.toLowerCase()),
    "INVALID_URL",
    "Only civitai.com and civitai.red model URLs are supported.",
  );
  assertCivitai(
    !url.hash,
    "INVALID_URL",
    "Civitai model URLs cannot contain a fragment.",
  );

  const match = modelPath.exec(url.pathname);
  assertCivitai(
    match?.[1],
    "INVALID_URL",
    "The URL must point to a Civitai model page.",
  );
  const modelId = parseSafePositiveInteger(match[1], "model ID");

  const queryKeys = [...url.searchParams.keys()];
  assertCivitai(
    queryKeys.every((key) => key === "modelVersionId"),
    "INVALID_URL",
    "The Civitai URL contains unsupported query parameters.",
  );
  const versionValues = url.searchParams.getAll("modelVersionId");
  assertCivitai(
    versionValues.length <= 1,
    "INVALID_URL",
    "The Civitai URL contains more than one model version.",
  );
  const modelVersionId =
    versionValues.length === 1
      ? parseSafePositiveInteger(versionValues[0]!, "model version ID")
      : null;

  const host = url.hostname.toLowerCase() as CivitaiPageHost;
  const canonical = new URL(`https://${host}/models/${modelId}`);
  if (modelVersionId !== null) {
    canonical.searchParams.set("modelVersionId", String(modelVersionId));
  }

  return {
    provider: "civitai",
    host,
    modelId,
    modelVersionId,
    canonicalUrl: canonical.toString(),
    unrestrictedSource: host === "civitai.red",
  };
}
