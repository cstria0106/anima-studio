import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function resolveFromRepository(value: string): string {
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

export interface AppConfig {
  host: string;
  port: number;
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
  danbooruDescriptionsCsvPath: string;
  danbooruCooccurrenceCsvPath: string;
  danbooruManifestPath: string;
  danbooruMinimumCooccurrenceCount: number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir
    ? resolveFromRepository(overrides.dataDir)
    : join(repositoryRoot, "data");
  const databasePath =
    overrides.databasePath === ":memory:"
      ? ":memory:"
      : overrides.databasePath
        ? resolveFromRepository(overrides.databasePath)
        : join(dataDir, "anima-studio.sqlite");

  return {
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 8787,
    dataDir,
    runtimeDir: overrides.runtimeDir
      ? resolveFromRepository(overrides.runtimeDir)
      : join(dataDir, "runtime"),
    databasePath,
    migrationsDir: overrides.migrationsDir
      ? resolveFromRepository(overrides.migrationsDir)
      : join(packageRoot, "drizzle"),
    maxUploadBytes: overrides.maxUploadBytes ?? 25 * 1024 * 1024,
    maxUploadBatchBytes: overrides.maxUploadBatchBytes ?? 100 * 1024 * 1024,
    maxImageDimension: overrides.maxImageDimension ?? 16_384,
    maxImagePixels: overrides.maxImagePixels ?? 100_000_000,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 15_000,
    queuePollMs: overrides.queuePollMs ?? 3_000,
    managedRuntimeMinimumFreeBytes:
      overrides.managedRuntimeMinimumFreeBytes ?? 25 * 1024 * 1024 * 1024,
    managedRuntimeStartTimeoutMs:
      overrides.managedRuntimeStartTimeoutMs ?? 120_000,
    managedRuntimeStopTimeoutMs:
      overrides.managedRuntimeStopTimeoutMs ?? 15_000,
    managedRuntimePortStart: overrides.managedRuntimePortStart ?? 8188,
    managedRuntimePortEnd: overrides.managedRuntimePortEnd ?? 8199,
    danbooruTagsCsvPath: overrides.danbooruTagsCsvPath
      ? resolveFromRepository(overrides.danbooruTagsCsvPath)
      : join(repositoryRoot, "packages", "tag-data", "data", "danbooru_tags.csv"),
    danbooruDescriptionsCsvPath: overrides.danbooruDescriptionsCsvPath
      ? resolveFromRepository(overrides.danbooruDescriptionsCsvPath)
      : join(
          repositoryRoot,
          "packages",
          "tag-data",
          "data",
          "danbooru_tags_ko.csv",
        ),
    danbooruCooccurrenceCsvPath: overrides.danbooruCooccurrenceCsvPath
      ? resolveFromRepository(overrides.danbooruCooccurrenceCsvPath)
      : join(
          repositoryRoot,
          "packages",
          "tag-data",
          "data",
          "danbooru_tags_cooccurrence.csv",
        ),
    danbooruManifestPath: overrides.danbooruManifestPath
      ? resolveFromRepository(overrides.danbooruManifestPath)
      : join(repositoryRoot, "packages", "tag-data", "data", "manifest.json"),
    danbooruMinimumCooccurrenceCount:
      overrides.danbooruMinimumCooccurrenceCount ?? 5_000,
  };
}
