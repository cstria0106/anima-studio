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
import { CIVITAI_IMAGE_HOSTS, CIVITAI_PAGE_HOSTS } from "./types";

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
const videoExtensions = /\.(?:m3u8|m4v|mov|mp4|webm)(?:$|[?#])/i;

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

function safeDownloadUrl(value: unknown, versionId: number): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !CIVITAI_PAGE_HOSTS.includes(
      url.hostname.toLowerCase() as (typeof CIVITAI_PAGE_HOSTS)[number],
    ) ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname.replace(/\/$/, "") !==
      `/api/download/models/${versionId}`
  ) {
    return null;
  }
  return url.toString();
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

function safeImageUrl(value: unknown): string | null {
  const image = object(value);
  if (!image) return null;
  const mediaType = cleanString(
    image.type ?? image.mediaType ?? image.mimeType,
    80,
  )?.toLocaleLowerCase();
  if (
    mediaType &&
    mediaType !== "image" &&
    !mediaType.startsWith("image/")
  ) {
    return null;
  }
  const rawUrl = cleanString(image.url, 2_000);
  if (!rawUrl || videoExtensions.test(rawUrl)) return null;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !(CIVITAI_IMAGE_HOSTS as readonly string[]).includes(
        url.hostname.toLocaleLowerCase(),
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function firstSafeImageUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const image of value) {
    const url = safeImageUrl(image);
    if (url) return url;
  }
  return null;
}

function fileBlockReason(
  kind: CivitaiModelKind,
  file: JsonObject,
  id: number | null,
  name: string | null,
  sha256: string | null,
  sizeBytes: number | null,
  downloadUrl: string | null,
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
  if (sizeBytes === null || sizeBytes <= 0) return "missing_file_size";
  if (downloadUrl === null) return "unsafe_download_url";
  return null;
}

function parseFile(
  kind: CivitaiModelKind,
  value: unknown,
  versionId: number,
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
  const sizeBytes = fileSizeBytes(file.sizeKB);
  const downloadUrl = safeDownloadUrl(file.downloadUrl, versionId);
  const blockReason = fileBlockReason(
    kind,
    file,
    id,
    name,
    sha256,
    sizeBytes,
    downloadUrl,
  );
  return {
    id,
    name: name ?? "Unsafe filename",
    sizeBytes,
    remoteType: cleanString(file.type, 80) ?? "",
    format: cleanString(metadata.format, 80),
    precision: cleanString(metadata.fp, 80),
    sizeVariant: cleanString(metadata.size, 80),
    primary: file.primary === true,
    sha256,
    downloadUrl,
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
        const parsed = parseFile(kind, file, id);
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
    thumbnailUrl: firstSafeImageUrl(version.images),
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
