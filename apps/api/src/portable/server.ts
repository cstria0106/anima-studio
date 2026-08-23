import type { EmbeddedStaticSite } from "./static";
import { PORTABLE_APP_HOST, PORTABLE_APP_PORT } from "./network";

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
  options: {
    hostname?: string;
    startPort?: number;
    findAvailablePort?: boolean;
  } = {},
): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? PORTABLE_APP_HOST;
  const startPort = options.startPort ?? PORTABLE_APP_PORT;
  const lastPort = options.findAvailablePort === false ? startPort : 65_535;
  for (let port = startPort; port <= lastPort; port += 1) {
    try {
      return Bun.serve({
        hostname,
        port,
        fetch,
        idleTimeout: 120,
      });
    } catch (error) {
      if (!addressInUse(error)) throw error;
      if (options.findAvailablePort === false) {
        throw new Error(`TCP port ${port} is already in use on ${hostname}.`);
      }
    }
  }
  throw new Error(`No available TCP port exists at or above ${startPort}.`);
}
