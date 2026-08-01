export const PORTABLE_APP_PORT = 8787;

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
