import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export function portableDataDirectory(executablePath = process.execPath): string {
  return join(dirname(executablePath), "data");
}

export async function assertPortableDataWritable(dataDir: string): Promise<void> {
  const appDir = join(dataDir, "_app");
  const probe = join(appDir, `.write-test-${process.pid}-${randomUUID()}`);
  try {
    await mkdir(appDir, { recursive: true });
    const handle = await open(probe, "wx");
    await handle.close();
    await rm(probe);
  } catch (error) {
    await rm(probe, { force: true }).catch(() => undefined);
    throw new Error(
      `Anima Studio cannot write to its portable data directory:\n${dataDir}\n` +
        "Move AnimaStudio.exe to a writable folder such as C:\\AnimaStudio and run it again. " +
        "The app will not fall back to LocalAppData.",
      { cause: error },
    );
  }
}
