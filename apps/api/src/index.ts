import { createRuntime } from "./app";
import { createShutdownHandler } from "./lifecycle";

const runtime = await createRuntime();
const server = Bun.serve({
  hostname: runtime.config.host,
  port: runtime.config.port,
  fetch: runtime.app.fetch,
  idleTimeout: 120,
});

console.log(`Anima Studio API: http://${server.hostname}:${server.port}`);
console.log(`ComfyUI: ${runtime.comfy.baseUrl}`);
console.log(`Data: ${runtime.config.dataDir}`);

const shutdown = createShutdownHandler(server, runtime);

function handleSignal(signal: "SIGINT" | "SIGTERM"): void {
  void shutdown().catch(() => {
    console.error(`Anima Studio API shutdown failed after ${signal}.`);
    process.exitCode = 1;
  });
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

export { createApp, createRuntime } from "./app";
