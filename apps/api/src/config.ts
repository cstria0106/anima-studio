import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function resolveFromRepository(value: string): string {
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

function readRepositoryEnvironment(): Record<string, string> {
  const loaded: Record<string, string> = {};
  for (const filename of [".env", ".env.local"]) {
    try {
      Object.assign(
        loaded,
        parseEnv(readFileSync(join(repositoryRoot, filename), "utf8")),
      );
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT") {
        throw new Error(`Could not load ${filename}.`, { cause: error });
      }
    }
  }
  return loaded;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export interface AppConfig {
  host: string;
  port: number;
  comfyUrl: string;
  comfyUrlExplicit: boolean;
  dataDir: string;
  runtimeDir: string;
  databasePath: string;
  migrationsDir: string;
  maxUploadBytes: number;
  maxUploadBatchBytes: number;
  maxImageDimension: number;
  maxImagePixels: number;
  requestTimeoutMs: number;
  queuePollMs: number;
  managedRuntimeMinimumFreeBytes: number;
  managedRuntimeStartTimeoutMs: number;
  managedRuntimeStopTimeoutMs: number;
  managedRuntimePortStart: number;
  managedRuntimePortEnd: number;
  danbooruTagsCsvPath: string;
  danbooruCooccurrenceCsvPath: string;
  danbooruManifestPath: string;
  danbooruMinimumCooccurrenceCount: number;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const source =
    env === process.env
      ? { ...readRepositoryEnvironment(), ...env }
      : env;
  const dataDir = source.DATA_DIR
    ? resolveFromRepository(source.DATA_DIR)
    : join(repositoryRoot, "data");
  const databasePath =
    source.DATABASE_PATH === ":memory:"
      ? ":memory:"
      : source.DATABASE_PATH
        ? resolveFromRepository(source.DATABASE_PATH)
        : join(dataDir, "anima-studio.sqlite");

  return {
    host: "127.0.0.1",
    port: readPositiveInteger(source.API_PORT ?? source.PORT, 8787, "API_PORT"),
    comfyUrl: (source.COMFY_URL?.trim() || "http://127.0.0.1:8188").replace(
      /\/+$/,
      "",
    ),
    comfyUrlExplicit: Boolean(source.COMFY_URL?.trim()),
    dataDir,
    runtimeDir: source.RUNTIME_DIR
      ? resolveFromRepository(source.RUNTIME_DIR)
      : join(dataDir, "runtime"),
    databasePath,
    migrationsDir: source.MIGRATIONS_DIR
      ? resolveFromRepository(source.MIGRATIONS_DIR)
      : join(packageRoot, "drizzle"),
    maxUploadBytes: readPositiveInteger(
      source.MAX_UPLOAD_BYTES,
      25 * 1024 * 1024,
      "MAX_UPLOAD_BYTES",
    ),
    maxUploadBatchBytes: readPositiveInteger(
      source.MAX_UPLOAD_BATCH_BYTES,
      100 * 1024 * 1024,
      "MAX_UPLOAD_BATCH_BYTES",
    ),
    maxImageDimension: readPositiveInteger(
      source.MAX_IMAGE_DIMENSION,
      16_384,
      "MAX_IMAGE_DIMENSION",
    ),
    maxImagePixels: readPositiveInteger(
      source.MAX_IMAGE_PIXELS,
      100_000_000,
      "MAX_IMAGE_PIXELS",
    ),
    requestTimeoutMs: readPositiveInteger(
      source.COMFY_REQUEST_TIMEOUT_MS,
      15_000,
      "COMFY_REQUEST_TIMEOUT_MS",
    ),
    queuePollMs: readPositiveInteger(
      source.COMFY_QUEUE_POLL_MS,
      3_000,
      "COMFY_QUEUE_POLL_MS",
    ),
    managedRuntimeMinimumFreeBytes: readPositiveInteger(
      source.MANAGED_RUNTIME_MIN_FREE_BYTES,
      25 * 1024 * 1024 * 1024,
      "MANAGED_RUNTIME_MIN_FREE_BYTES",
    ),
    managedRuntimeStartTimeoutMs: readPositiveInteger(
      source.MANAGED_RUNTIME_START_TIMEOUT_MS,
      120_000,
      "MANAGED_RUNTIME_START_TIMEOUT_MS",
    ),
    managedRuntimeStopTimeoutMs: readPositiveInteger(
      source.MANAGED_RUNTIME_STOP_TIMEOUT_MS,
      15_000,
      "MANAGED_RUNTIME_STOP_TIMEOUT_MS",
    ),
    managedRuntimePortStart: readPositiveInteger(
      source.MANAGED_RUNTIME_PORT_START,
      8188,
      "MANAGED_RUNTIME_PORT_START",
    ),
    managedRuntimePortEnd: readPositiveInteger(
      source.MANAGED_RUNTIME_PORT_END,
      8199,
      "MANAGED_RUNTIME_PORT_END",
    ),
    danbooruTagsCsvPath: source.DANBOORU_TAGS_CSV
      ? resolveFromRepository(source.DANBOORU_TAGS_CSV)
      : join(repositoryRoot, "packages", "tag-data", "data", "danbooru_tags.csv"),
    danbooruCooccurrenceCsvPath: source.DANBOORU_COOCCURRENCE_CSV
      ? resolveFromRepository(source.DANBOORU_COOCCURRENCE_CSV)
      : join(
          repositoryRoot,
          "packages",
          "tag-data",
          "data",
          "danbooru_tags_cooccurrence.csv",
        ),
    danbooruManifestPath: source.DANBOORU_TAG_DATA_MANIFEST
      ? resolveFromRepository(source.DANBOORU_TAG_DATA_MANIFEST)
      : join(repositoryRoot, "packages", "tag-data", "data", "manifest.json"),
    danbooruMinimumCooccurrenceCount: readNonNegativeInteger(
      source.DANBOORU_COOCCURRENCE_MIN_COUNT,
      5_000,
      "DANBOORU_COOCCURRENCE_MIN_COUNT",
    ),
  };
}
