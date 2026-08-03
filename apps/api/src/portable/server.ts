import type { EmbeddedStaticSite } from "./static";

export const PORTABLE_APP_PORT = 8787;

export interface PortableStartupHandler {
  fetch(request: Request): Response | Promise<Response>;
  activate(fetch: (request: Request) => Response | Promise<Response>): void;
}

export function createPortableStartupHandler(
  staticSite: EmbeddedStaticSite,
): PortableStartupHandler {
  let runtimeFetch:
    | ((request: Request) => Response | Promise<Response>)
    | null = null;
  return {
    fetch(request) {
      if (runtimeFetch) return runtimeFetch(request);
      const url = new URL(request.url);
      const staticResponse = staticSite.response(url.pathname);
      if (staticResponse) return staticResponse;
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return Response.json(
          { error: "Anima Studio is starting." },
          {
            status: 503,
            headers: { "Retry-After": "1" },
          },
        );
      }
      return new Response("Not Found", { status: 404 });
    },
    activate(fetch) {
      runtimeFetch = fetch;
    },
  };
}

function addressInUse(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: unknown }).code === "EADDRINUSE";
  }
  return error instanceof Error && /port.+in use|EADDRINUSE/i.test(error.message);
}

export function startPortableServer(
  fetch: (request: Request) => Response | Promise<Response>,
  startPort = PORTABLE_APP_PORT,
): ReturnType<typeof Bun.serve> {
  for (let port = startPort; port <= 65_535; port += 1) {
    try {
      return Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch,
        idleTimeout: 120,
      });
    } catch (error) {
      if (!addressInUse(error)) throw error;
    }
  }
  throw new Error(`No available TCP port exists at or above ${startPort}.`);
}
