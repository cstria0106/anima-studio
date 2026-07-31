import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { compareVersions, GitHubUpdateService } from "./update";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("GitHub update checks", () => {
  test("compares stable semantic versions", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(0);
  });

  test("ignores prereleases and reuses the 24-hour cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "anima-update-"));
    cleanup.push(root);
    let calls = 0;
    const request = (async () => {
      calls += 1;
      return Response.json([
        { tag_name: "v9.0.0-beta.1", html_url: "https://example/pre", prerelease: true },
        { tag_name: "v1.2.0", html_url: "https://example/stable", prerelease: false },
      ], { headers: { etag: '"release-etag"' } });
    });
    const now = () => new Date("2026-08-01T00:00:00Z");
    const service = new GitHubUpdateService("1.0.0", join(root, "cache.json"), request, now);
    expect(await service.check()).toMatchObject({ latestVersion: "1.2.0", updateAvailable: true });
    expect(await service.check()).toMatchObject({ latestVersion: "1.2.0" });
    expect(calls).toBe(1);
  });

  test("uses ETag after expiry and remains usable on network failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "anima-update-"));
    cleanup.push(root);
    let time = new Date("2026-08-01T00:00:00Z");
    let ifNoneMatch: string | null = null;
    let calls = 0;
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      ifNoneMatch = new Headers(init?.headers).get("if-none-match");
      if (calls === 1) return Response.json([{ tag_name: "v1.1.0", html_url: "https://example/release" }], { headers: { etag: '"e1"' } });
      if (calls === 2) return new Response(null, { status: 304 });
      throw new Error("offline");
    });
    const service = new GitHubUpdateService("1.0.0", join(root, "cache.json"), request, () => time);
    await service.check();
    time = new Date("2026-08-03T00:00:00Z");
    expect((await service.check()).latestVersion).toBe("1.1.0");
    expect(String(ifNoneMatch)).toBe('"e1"');
    time = new Date("2026-08-05T00:00:00Z");
    expect((await service.check()).updateAvailable).toBeTrue();
  });
});
