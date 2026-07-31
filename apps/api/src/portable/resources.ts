import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface EmbeddedResource {
  path: string;
  sha256: string;
  size: number;
  blob: Blob;
}

export interface ExtractedResources {
  root: string;
  migrationsDir: string;
  tagDataDir: string;
}

function safeDestination(root: string, relativePath: string): string {
  const destination = resolve(root, relativePath);
  const prefix = resolve(root) + sep;
  if (!destination.startsWith(prefix)) {
    throw new Error(`Embedded resource path escapes its root: ${relativePath}`);
  }
  return destination;
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    hash.update(await readFile(path));
    return hash.digest("hex");
  } catch {
    return null;
  }
}

async function verifyResourceSet(
  root: string,
  resources: readonly EmbeddedResource[],
): Promise<boolean> {
  for (const resource of resources) {
    const destination = safeDestination(root, resource.path);
    const details = await stat(destination).catch(() => null);
    if (!details?.isFile() || details.size !== resource.size) return false;
    if ((await fileSha256(destination)) !== resource.sha256) return false;
  }
  return true;
}

async function writeResourceSet(
  root: string,
  resources: readonly EmbeddedResource[],
): Promise<void> {
  for (const resource of resources) {
    const destination = safeDestination(root, resource.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, new Uint8Array(await resource.blob.arrayBuffer()), {
      flag: "wx",
    });
  }
  if (!(await verifyResourceSet(root, resources))) {
    throw new Error("Extracted application resources failed SHA-256 verification.");
  }
}

export async function extractEmbeddedResources(
  dataDir: string,
  contentHash: string,
  resources: readonly EmbeddedResource[],
): Promise<ExtractedResources> {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error("Invalid embedded resource content hash.");
  }
  const resourcesRoot = join(dataDir, "_app", "resources");
  const target = join(resourcesRoot, contentHash);
  await mkdir(resourcesRoot, { recursive: true });
  if (!(await verifyResourceSet(target, resources))) {
    const temporary = join(resourcesRoot, `.${contentHash}.${randomUUID()}.tmp`);
    const replaced = join(resourcesRoot, `.${contentHash}.${randomUUID()}.old`);
    await mkdir(temporary, { recursive: false });
    try {
      await writeResourceSet(temporary, resources);
      const targetExists = await stat(target).then(() => true).catch(() => false);
      if (targetExists) await rename(target, replaced);
      try {
        await rename(temporary, target);
      } catch (error) {
        if (targetExists) await rename(replaced, target).catch(() => undefined);
        throw error;
      }
      await rm(replaced, { recursive: true, force: true });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    root: target,
    migrationsDir: join(target, "migrations"),
    tagDataDir: join(target, "tag-data"),
  };
}

export const resourceTesting = { verifyResourceSet };
