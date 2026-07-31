import type { EmbeddedResource } from "./resources";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

function normalizeRequestPath(pathname: string): string | null {
  if (pathname === "/api" || pathname.startsWith("/api/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.split("/").includes("..")) return null;
  if (decoded === "/" || decoded.endsWith("/")) return "index.html";
  return decoded.replace(/^\/+/, "");
}

export class EmbeddedStaticSite {
  private readonly files = new Map<string, EmbeddedResource>();

  constructor(resources: readonly EmbeddedResource[]) {
    for (const resource of resources) this.files.set(resource.path, resource);
  }

  response(pathname: string): Response | null {
    const requested = normalizeRequestPath(pathname);
    if (!requested) return null;
    const exact = this.files.get(requested);
    const spa = extension(requested) ? null : this.files.get("index.html");
    const resource = exact ?? spa;
    if (!resource) return null;
    const immutable = resource.path.startsWith("_next/static/");
    return new Response(resource.blob, {
      headers: {
        "Content-Type": MIME_TYPES[extension(resource.path)] ?? "application/octet-stream",
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        ETag: `"${resource.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
