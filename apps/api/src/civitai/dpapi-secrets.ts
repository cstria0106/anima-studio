import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CivitaiError, assertCivitai } from "./errors";
import type { SecretStore } from "./types";

const maximumSecretBytes = 64 * 1_024;
const maximumProcessOutputBytes = 256 * 1_024;
const validSecretKey = /^[a-zA-Z0-9._-]{1,128}$/;

const protectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd()
$plain = [Convert]::FromBase64String($inputBase64)
$protected = $null
try {
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($protected))
} finally {
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
}
`;

const unprotectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd()
$protected = [Convert]::FromBase64String($inputBase64)
$plain = $null
try {
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} finally {
  if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
}
`;

export interface CurrentUserDataProtector {
  protect(plain: Uint8Array): Promise<Uint8Array>;
  unprotect(protectedBytes: Uint8Array): Promise<Uint8Array>;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim();
  if (
    !normalized ||
    !/^[a-zA-Z0-9+/]*={0,2}$/.test(normalized) ||
    normalized.length % 4 !== 0
  ) {
    throw new CivitaiError(
      "AUTH_REQUIRED",
      "Windows could not protect the Civitai token.",
      500,
    );
  }
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

/**
 * Windows DPAPI CurrentUser adapter. Plaintext is never placed in the child
 * command line or environment; only process pipes carry the in-memory value.
 */
export class WindowsCurrentUserDpapi
  implements CurrentUserDataProtector
{
  constructor(
    private readonly executable = "powershell.exe",
    private readonly platform = process.platform,
  ) {}

  protect(plain: Uint8Array): Promise<Uint8Array> {
    return this.run(protectScript, plain);
  }

  unprotect(protectedBytes: Uint8Array): Promise<Uint8Array> {
    return this.run(unprotectScript, protectedBytes);
  }

  private run(
    script: string,
    input: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.platform !== "win32") {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "Windows DPAPI is unavailable on this platform.",
        500,
      );
    }
    if (input.byteLength > maximumSecretBytes * 2) {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The secret is too large to protect.",
        400,
      );
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        this.executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script,
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let finished = false;

      const fail = () => {
        if (finished) return;
        finished = true;
        child.kill();
        rejectPromise(
          new CivitaiError(
            "AUTH_REQUIRED",
            "Windows could not protect the Civitai token.",
            500,
          ),
        );
      };

      child.on("error", fail);
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maximumProcessOutputBytes) {
          fail();
          return;
        }
        stdout.push(chunk);
      });
      // Drain but never retain or propagate third-party stderr.
      child.stderr.on("data", () => undefined);
      child.stdin.on("error", fail);
      child.on("close", (code) => {
        if (finished) return;
        if (code !== 0) {
          fail();
          return;
        }
        try {
          const result = decodeBase64(
            Buffer.concat(stdout).toString("utf8"),
          );
          finished = true;
          resolvePromise(result);
        } catch {
          fail();
        }
      });
      child.stdin.end(Buffer.from(input).toString("base64"));
    });
  }
}

/**
 * DPAPI-backed file store. SQLite stores only the configured/not-configured
 * state; protected bytes live under this app-owned directory.
 */
export class DpapiFileSecretStore implements SecretStore {
  private readonly root: string;

  constructor(
    root: string,
    private readonly protector: CurrentUserDataProtector =
      new WindowsCurrentUserDpapi(),
  ) {
    assertCivitai(
      isAbsolute(root),
      "AUTH_REQUIRED",
      "The secret store directory must be absolute.",
      500,
    );
    this.root = resolve(root);
    assertCivitai(
      resolve(this.root, "..") !== this.root,
      "AUTH_REQUIRED",
      "The secret store cannot use a filesystem root.",
      500,
    );
  }

  async read(key: string): Promise<string | null> {
    let protectedBytes: Uint8Array;
    let plain: Uint8Array | null = null;
    try {
      protectedBytes = new Uint8Array(
        await readFile(this.pathForKey(key)),
      );
    } catch (error) {
      if (filesystemErrorCode(error) === "ENOENT") return null;
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token store could not be read.",
        500,
      );
    }
    try {
      plain = await this.protector.unprotect(protectedBytes);
      if (plain.byteLength > maximumSecretBytes) {
        throw new Error("oversized secret");
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token could not be decrypted for this Windows user.",
        500,
      );
    } finally {
      protectedBytes.fill(0);
      plain?.fill(0);
    }
  }

  async write(key: string, secret: string): Promise<void> {
    const path = this.pathForKey(key);
    const plain = new TextEncoder().encode(secret);
    if (plain.byteLength === 0 || plain.byteLength > maximumSecretBytes) {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The secret is outside the supported size.",
        400,
      );
    }
    let protectedBytes: Uint8Array;
    try {
      protectedBytes = await this.protector.protect(plain);
    } finally {
      plain.fill(0);
    }
    await mkdir(this.root, { recursive: true });
    const temporaryPath = join(
      this.root,
      `.secret-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, protectedBytes, {
        flag: "wx",
        mode: 0o600,
      });
      await rm(path, { force: true });
      await rename(temporaryPath, path);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token store could not be updated.",
        500,
      );
    } finally {
      protectedBytes.fill(0);
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true }).catch(() => {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token store could not be updated.",
        500,
      );
    });
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathForKey(key))).isFile();
    } catch (error) {
      if (filesystemErrorCode(error) === "ENOENT") return false;
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token store could not be read.",
        500,
      );
    }
  }

  private pathForKey(key: string): string {
    assertCivitai(
      validSecretKey.test(key),
      "AUTH_REQUIRED",
      "The secret key is invalid.",
      500,
    );
    const filename = `${createHash("sha256").update(key).digest("hex")}.dpapi`;
    return join(this.root, filename);
  }
}

function filesystemErrorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
}
