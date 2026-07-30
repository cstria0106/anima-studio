import { CivitaiError, assertCivitai } from "./errors";
import type {
  CivitaiFileBlockReason,
  CivitaiFileInspection,
  CivitaiLicenseSnapshot,
  CivitaiModelInspection,
  CivitaiModelKind,
  CivitaiModelReference,
  CivitaiVersionInspection,
} from "./types";

type JsonObject = Record<string, unknown>;

const loraTypes = new Set(["lora", "locon", "lycoris", "dora"]);
const checkpointTypes = new Set([
  "checkpoint",
  "diffusion model",
  "diffusionmodel",
]);
const acceptedRemoteFileTypes = new Set(["model", "diffusion model"]);
const unsafeScanValues = new Set([
  "danger",
  "error",
  "failed",
  "infected",
  "malicious",
]);
const sha256Pattern = /^[a-f0-9]{64}$/i;

function object(value: unknown): JsonObject | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function cleanString(
  value: unknown,
  maximumLength = 300,
): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, maximumLength) : null;
}

function positiveId(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringList(
  value: unknown,
  maximumItems: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const clean = cleanString(item, 200);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function normalizeKind(value: unknown): CivitaiModelKind | null {
  const normalized = cleanString(value)?.toLocaleLowerCase();
  if (!normalized) return null;
  if (loraTypes.has(normalized)) return "lora";
  if (checkpointTypes.has(normalized)) return "checkpoint";
  return null;
}

export function normalizeSha256(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return sha256Pattern.test(normalized) ? normalized : null;
}

function safeFilename(value: unknown): string | null {
  const name = cleanString(value, 240);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /[<>:"|?*]/.test(name) ||
    /[. ]$/.test(name)
  ) {
    return null;
  }
  return name;
}

function fileSizeBytes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const bytes = Math.round(value * 1_024);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

function scanIsUnsafe(file: JsonObject): boolean {
  const results = [
    cleanString(file.pickleScanResult),
    cleanString(file.virusScanResult),
  ];
  return results.some(
    (result) =>
      result !== null &&
      unsafeScanValues.has(result.toLocaleLowerCase()),
  );
}

function fileBlockReason(
  kind: CivitaiModelKind,
  file: JsonObject,
  id: number | null,
  name: string | null,
  sha256: string | null,
): CivitaiFileBlockReason | null {
  if (id === null) return "invalid_file_id";
  if (name === null) return "unsafe_filename";
  if (!name.toLocaleLowerCase().endsWith(".safetensors")) {
    return "not_safetensors";
  }
  const remoteType = cleanString(file.type)?.toLocaleLowerCase() ?? "";
  if (!acceptedRemoteFileTypes.has(remoteType)) {
    return "unsupported_file_type";
  }
  if (
    kind === "lora" &&
    remoteType === "diffusion model"
  ) {
    return "unsupported_file_type";
  }
  if (scanIsUnsafe(file)) return "unsafe_scan_result";
  if (sha256 === null) return "missing_sha256";
  return null;
}

function parseFile(
  kind: CivitaiModelKind,
  value: unknown,
): CivitaiFileInspection | null {
  const file = object(value);
  if (!file) return null;
  const id = positiveId(file.id);
  const name = safeFilename(file.name);
  const metadata = object(file.metadata) ?? {};
  const hashes = object(file.hashes) ?? {};
  const sha256 = normalizeSha256(
    hashes.SHA256 ?? hashes.sha256 ?? file.sha256,
  );
  const blockReason = fileBlockReason(kind, file, id, name, sha256);
  return {
    id,
    name: name ?? "Unsafe filename",
    sizeBytes: fileSizeBytes(file.sizeKB),
    remoteType: cleanString(file.type, 80) ?? "",
    format: cleanString(metadata.format, 80),
    precision: cleanString(metadata.fp, 80),
    sizeVariant: cleanString(metadata.size, 80),
    primary: file.primary === true,
    sha256,
    eligible: blockReason === null,
    blockReason,
  };
}

function parseVersion(
  kind: CivitaiModelKind,
  value: unknown,
): CivitaiVersionInspection | null {
  const version = object(value);
  if (!version) return null;
  const id = positiveId(version.id);
  if (id === null) return null;
  const files = Array.isArray(version.files)
    ? version.files.flatMap((file) => {
        const parsed = parseFile(kind, file);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    id,
    name: cleanString(version.name) ?? `Version ${id}`,
    baseModel: cleanString(version.baseModel),
    createdAt: cleanString(version.createdAt, 80),
    publishedAt: cleanString(version.publishedAt, 80),
    earlyAccessEndsAt:
      cleanString(version.earlyAccessEndsAt, 80) ??
      cleanString(version.earlyAccessTimeFrame, 80),
    triggerWords: stringList(
      version.trainedWords ?? version.triggerWords,
      100,
    ),
    files,
  };
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseLicense(model: JsonObject): CivitaiLicenseSnapshot {
  const commercial = model.allowCommercialUse;
  return {
    allowNoCredit: optionalBoolean(model.allowNoCredit),
    allowCommercialUse: Array.isArray(commercial)
      ? stringList(commercial, 20)
      : cleanString(commercial, 200)
        ? [cleanString(commercial, 200)!]
        : [],
    allowDerivatives: optionalBoolean(model.allowDerivatives),
    allowDifferentLicense: optionalBoolean(
      model.allowDifferentLicense,
    ),
  };
}

function isNsfw(model: JsonObject): boolean {
  if (model.nsfw === true) return true;
  if (typeof model.nsfwLevel === "number") return model.nsfwLevel > 0;
  const value = cleanString(model.nsfwLevel)?.toLocaleLowerCase();
  return Boolean(value && value !== "none" && value !== "false" && value !== "0");
}

/**
 * Convert the Civitai API response to a small, allowlisted inspection object.
 * Raw HTML descriptions, API-only URLs and unrecognized metadata are omitted.
 */
export function parseCivitaiModelResponse(
  reference: CivitaiModelReference,
  value: unknown,
): CivitaiModelInspection {
  const model = object(value);
  assertCivitai(
    model,
    "INVALID_MODEL",
    "Civitai returned invalid model metadata.",
    502,
  );
  const modelId = positiveId(model.id);
  assertCivitai(
    modelId === reference.modelId,
    "INVALID_MODEL",
    "Civitai returned metadata for a different model.",
    502,
  );
  const kind = normalizeKind(model.type);
  if (!kind) {
    throw new CivitaiError(
      "UNSUPPORTED_MODEL",
      "Only LoRA and checkpoint models are supported.",
      400,
    );
  }

  const versions = Array.isArray(model.modelVersions)
    ? model.modelVersions.flatMap((version) => {
        const parsed = parseVersion(kind, version);
        return parsed ? [parsed] : [];
      })
    : [];
  const selectedVersions =
    reference.modelVersionId === null
      ? versions
      : versions.filter(
          (version) => version.id === reference.modelVersionId,
        );
  if (reference.modelVersionId !== null && selectedVersions.length === 0) {
    throw new CivitaiError(
      "NOT_FOUND",
      "The selected Civitai model version was not found.",
      404,
    );
  }
  assertCivitai(
    selectedVersions.length > 0,
    "NOT_FOUND",
    "This Civitai model has no downloadable versions.",
    404,
  );

  const creator = object(model.creator);
  return {
    reference,
    modelId,
    name: cleanString(model.name) ?? `Model ${modelId}`,
    kind,
    creator: cleanString(creator?.username ?? model.username),
    tags: stringList(model.tags, 200),
    nsfw: isNsfw(model),
    license: parseLicense(model),
    versions: selectedVersions,
  };
}
