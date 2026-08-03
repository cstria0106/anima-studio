import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
}

export type UpdateFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface UpdateCache {
  etag: string | null;
  fetchedAt: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

function versionParts(version: string): number[] | null {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

async function readCache(path: string): Promise<UpdateCache | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<UpdateCache>;
    if (
      typeof value.fetchedAt === "string" &&
      (typeof value.etag === "string" || value.etag === null) &&
      (typeof value.latestVersion === "string" || value.latestVersion === null) &&
      (typeof value.releaseUrl === "string" || value.releaseUrl === null) &&
      (value.releaseNotes === undefined ||
        typeof value.releaseNotes === "string" ||
        value.releaseNotes === null)
    ) {
      return {
        ...(value as Omit<UpdateCache, "releaseNotes">),
        releaseNotes: value.releaseNotes ?? null,
      };
    }
  } catch {}
  return null;
}

export class GitHubUpdateService {
  constructor(
    private readonly currentVersion: string,
    private readonly cachePath: string,
    private readonly request: UpdateFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async clearCache(): Promise<void> {
    await rm(this.cachePath, { force: true });
  }

  private result(cache: UpdateCache | null): AppUpdateInfo {
    return {
      currentVersion: this.currentVersion,
      latestVersion: cache?.latestVersion ?? null,
      updateAvailable:
        cache?.latestVersion !== null && cache?.latestVersion !== undefined
          ? compareVersions(cache.latestVersion, this.currentVersion) > 0
          : false,
      releaseUrl: cache?.releaseUrl ?? null,
      releaseNotes: cache?.releaseNotes ?? null,
      checkedAt: cache?.fetchedAt ?? null,
    };
  }

  async check(forceRefresh = false): Promise<AppUpdateInfo> {
    const cached = await readCache(this.cachePath);
    const now = this.now();
    if (
      !forceRefresh &&
      cached &&
      now.getTime() - Date.parse(cached.fetchedAt) < DAY_MS
    ) {
      return this.result(cached);
    }
    try {
      const response = await this.request(
        "https://api.github.com/repos/cstria0106/anima-studio/releases?per_page=20",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `AnimaStudio/${this.currentVersion}`,
            ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      let next: UpdateCache;
      if (response.status === 304 && cached) {
        next = { ...cached, fetchedAt: now.toISOString() };
      } else {
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
        const releases = (await response.json()) as GitHubRelease[];
        const release = releases.find(
          (item) =>
            !item.draft &&
            !item.prerelease &&
            typeof item.tag_name === "string" &&
            versionParts(item.tag_name) !== null,
        );
        next = {
          etag: response.headers.get("etag"),
          fetchedAt: now.toISOString(),
          latestVersion: release?.tag_name?.replace(/^v/, "") ?? null,
          releaseUrl: release?.html_url ?? null,
          releaseNotes: release?.body?.trim() || null,
        };
      }
      await mkdir(dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(next, null, 2), "utf8");
      return this.result(next);
    } catch {
      return this.result(cached);
    }
  }
}
