import { join } from "node:path";
import { createRuntime } from "./app";
import { loadConfig } from "./config";
import { createShutdownHandler } from "./lifecycle";
import {
  APP_VERSION,
  EXTRACTED_RESOURCES,
  RESOURCE_CONTENT_HASH,
  STATIC_RESOURCES,
  TAG_DATA_CONTENT_HASH,
  THIRD_PARTY_NOTICES,
} from "./generated/resources";
import { InstanceCoordinator } from "./portable/instance";
import { parsePortableArguments } from "./portable/arguments";
import {
  PORTABLE_APP_PORT,
  portableUrl,
} from "./portable/network";
import {
  assertPortableDataWritable,
  portableDataDirectory,
} from "./portable/paths";
import { extractEmbeddedResources } from "./portable/resources";
import { EmbeddedStaticSite } from "./portable/static";
import { GitHubUpdateService } from "./portable/update";
import {
  createPortableStartupHandler,
  startPortableServer,
} from "./portable/server";

const REPOSITORY_URL = "https://github.com/cstria0106/anima-studio";

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
  const arguments_ = parsePortableArguments(process.argv.slice(2));
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
    const staticSite = new EmbeddedStaticSite(STATIC_RESOURCES);
    const startup = createPortableStartupHandler(staticSite);
    server = startPortableServer((request) => startup.fetch(request), {
      hostname: arguments_.host,
      startPort: arguments_.port ?? PORTABLE_APP_PORT,
      findAvailablePort: arguments_.port === undefined,
    });
    if (!server.port) throw new Error("Windows did not assign a server port.");
    actualPort = server.port;
    const url = portableUrl(arguments_.host, actualPort);
    await lease.publish(arguments_.host, actualPort);

    console.log(`Anima Studio ${APP_VERSION}`);
    console.log(`URL: ${url}`);
    console.log(`Data: ${dataDir}`);
    console.log("Press Ctrl+C to stop Anima Studio.");
    if (!arguments_.noBrowser) openBrowser(url);

    const config = loadConfig({
      host: arguments_.host,
      port: actualPort,
      dataDir,
      runtimeDir: join(dataDir, "runtime"),
      databasePath: join(dataDir, "anima-studio.sqlite"),
      migrationsDir: resources.migrationsDir,
      danbooruTagsCsvPath: join(resources.tagDataDir, "danbooru_tags.csv"),
      danbooruDescriptionsCsvPath: join(
        resources.tagDataDir,
        "danbooru_tags_ko.csv",
      ),
      danbooruCooccurrenceCsvPath: join(
        resources.tagDataDir,
        "danbooru_tags_cooccurrence.csv",
      ),
      danbooruTagDataFingerprint: TAG_DATA_CONTENT_HASH,
    });
    const updates = new GitHubUpdateService(
      APP_VERSION,
      join(dataDir, "_app", "update-cache.json"),
    );
    await updates.clearCache();
    runtime = await createRuntime({
      config,
      portableApp: {
        id: "anima-studio",
        version: APP_VERSION,
        repositoryUrl: REPOSITORY_URL,
        dataDir,
        instanceToken: lease.token,
        port: () => actualPort,
        updates,
        staticSite,
        thirdPartyNotices: THIRD_PARTY_NOTICES,
      },
    });
    startup.activate((request) => runtime!.app.fetch(request));

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
    } else {
      if (server) await server.stop(true).catch(() => undefined);
      if (runtime) await runtime.close().catch(() => undefined);
    }
    await lease.release();
    throw error;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
