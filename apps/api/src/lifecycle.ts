export interface ApiServerHandle {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

export interface ApiRuntimeHandle {
  close(): void | Promise<void>;
}

/**
 * Stop accepting API work and release runtime resources exactly once. Both
 * branches are settled so a server-stop failure cannot skip managed-runtime
 * cleanup (and vice versa).
 */
export function createShutdownHandler(
  server: ApiServerHandle,
  runtime: ApiRuntimeHandle,
): () => Promise<void> {
  let closing: Promise<void> | null = null;
  return () => {
    if (closing) return closing;
    closing = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => server.stop(true)),
        Promise.resolve().then(() => runtime.close()),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          "Anima Studio API shutdown did not complete cleanly.",
        );
      }
    })();
    return closing;
  };
}
