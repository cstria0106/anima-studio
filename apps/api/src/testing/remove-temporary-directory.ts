import { rm } from "node:fs/promises";

const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

/**
 * Removes a test directory that held a SQLite database.
 *
 * On Windows, bun:sqlite can keep the database and WAL files open until
 * cached statements are garbage collected, and Bun's rm() does not apply
 * Node's maxRetries option, so retry here with a collection between attempts.
 */
export async function removeTemporaryDirectory(
  directory: string,
  attempts = 10,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !RETRYABLE_CODES.has(code)) {
        throw error;
      }
      Bun.gc(true);
      await Bun.sleep(25 * attempt);
    }
  }
}
