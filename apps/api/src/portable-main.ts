import { join } from "node:path";
import { createRuntime } from "./app";
import { loadConfig } from "./config";
import { createShutdownHandler } from "./lifecycle";
import {
  APP_VERSION,
  EXTRACTED_RESOURCES,
  RESOURCE_CONTENT_HASH,
  STATIC_RESOURCES,
  THIRD_PARTY_NOTICES,
} from "./generated/resources";
import { InstanceCoordinator } from "./portable/instance";
import {
  assertPortableDataWritable,
  portableDataDirectory,
} from "./portable/paths";
import { extractEmbeddedResources } from "./portable/resources";
import { EmbeddedStaticSite } from "./portable/static";
import { GitHubUpdateService } from "./portable/update";

const REPOSITORY_URL = "https://github.com/cstria0106/anima-studio";

function parseArguments(args: string[]): { noBrowser: boolean; version: boolean } {
  let noBrowser = false;
  let version = false;
  for (const argument of args) {
    if (argument === "--no-browser") noBrowser = true;
    else if (argument === "--version") version = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return { noBrowser, version };
}

function openBrowser(url: string): void {
  const child = Bun.spawn(["cmd.exe", "/d", "/c", "start", "", url], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.version) {
    console.log(APP_VERSION);
    return;
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("AnimaStudio.exe supports Windows x64 only.");
  }

  const dataDir = portableDataDirectory();
  await assertPortableDataWritable(dataDir);
  const resources = await extractEmbeddedResources(
    dataDir,
    RESOURCE_CONTENT_HASH,
    EXTRACTED_RESOURCES,
  );
  const coordinator = new InstanceCoordinator(dataDir);
  const acquisition = await coordinator.acquire();
  if (!acquisition.owner) {
    console.log(`Anima Studio is already running: ${acquisition.url}`);
    if (!arguments_.noBrowser) openBrowser(acquisition.url);
    return;
  }

  const lease = acquisition.lease;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  try {
    let actualPort = 0;
    const config = loadConfig({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      runtimeDir: join(dataDir, "runtime"),
      databasePath: join(dataDir, "anima-studio.sqlite"),
      migrationsDir: resources.migrationsDir,
      danbooruTagsCsvPath: join(resources.tagDataDir, "danbooru_tags.csv"),
      danbooruDescriptionsCsvPath: join(resources.tagDataDir, "danbooru_tags_ko.csv"),
      danbooruCooccurrenceCsvPath: join(
        resources.tagDataDir,
        "danbooru_tags_cooccurrence.csv",
      ),
      danbooruManifestPath: join(resources.tagDataDir, "manifest.json"),
    });
    runtime = await createRuntime({
      config,
      portableApp: {
        id: "anima-studio",
        version: APP_VERSION,
        repositoryUrl: REPOSITORY_URL,
        dataDir,
        instanceToken: lease.token,
        port: () => actualPort,
        updates: new GitHubUpdateService(
          APP_VERSION,
          join(dataDir, "_app", "update-cache.json"),
        ),
        staticSite: new EmbeddedStaticSite(STATIC_RESOURCES),
        thirdPartyNotices: THIRD_PARTY_NOTICES,
      },
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: runtime.app.fetch,
      idleTimeout: 120,
    });
    if (!server.port) throw new Error("Windows did not assign a server port.");
    actualPort = server.port;
    const url = `http://127.0.0.1:${actualPort}`;
    await lease.publish(actualPort);

    console.log(`Anima Studio ${APP_VERSION}`);
    console.log(`URL: ${url}`);
    console.log(`Data: ${dataDir}`);
    console.log("Press Ctrl+C to stop Anima Studio.");
    if (!arguments_.noBrowser) openBrowser(url);

    const baseShutdown = createShutdownHandler(server, runtime);
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = () => {
      shutdownPromise ??= baseShutdown().finally(() => lease.release());
      return shutdownPromise;
    };
    const handleSignal = (signal: "SIGINT" | "SIGTERM") => {
      console.log(`\nStopping after ${signal}...`);
      void shutdown().catch((error) => {
        console.error("Anima Studio shutdown failed.", error);
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", () => handleSignal("SIGINT"));
    process.once("SIGTERM", () => handleSignal("SIGTERM"));
  } catch (error) {
    if (server && runtime) {
      await createShutdownHandler(server, runtime)().catch(() => undefined);
    } else if (runtime) {
      await runtime.close().catch(() => undefined);
    }
    await lease.release();
    throw error;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
