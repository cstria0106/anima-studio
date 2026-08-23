import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { join } from "node:path";
import {
  CimWindowsProcessInspector,
  isSameWindowsProcess,
  type WindowsProcessIdentity,
  type WindowsProcessInspector,
} from "../process/windows";
import { portableUrl } from "./network";

export interface InstanceDescriptor extends WindowsProcessIdentity {
  token: string;
  host: string;
  port: number;
}

interface InstanceLock extends WindowsProcessIdentity {
  token: string;
}

export type InstanceAcquisition =
  | { owner: true; lease: InstanceLease }
  | { owner: false; url: string };

export interface InstanceCoordinatorOptions {
  inspector?: WindowsProcessInspector;
  fetch?: typeof fetch;
  executablePath?: string;
  pid?: number;
  startupWaitMs?: number;
  pollMs?: number;
}

function validIdentity(value: unknown): value is InstanceLock {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InstanceLock>;
  return (
    Number.isSafeInteger(item.pid) &&
    Number(item.pid) > 0 &&
    typeof item.executable === "string" &&
    typeof item.startedAt === "string" &&
    typeof item.token === "string" &&
    /^[a-f0-9]{64}$/.test(item.token)
  );
}

function validDescriptor(value: unknown): value is InstanceDescriptor {
  if (!validIdentity(value)) return false;
  const item = value as Partial<InstanceDescriptor>;
  return (
    typeof item.host === "string" &&
    isIPv4(item.host) &&
    Number.isSafeInteger(item.port) &&
    Number(item.port) > 0 &&
    Number(item.port) <= 65_535
  );
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function removeIfTokenMatches(path: string, token: string): Promise<void> {
  const value = await readJson(path);
  if (validIdentity(value) && value.token === token) await rm(path, { force: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class InstanceLease {
  readonly token: string;
  readonly identity: WindowsProcessIdentity;
  private readonly lockPath: string;
  private readonly descriptorPath: string;

  constructor(
    lockPath: string,
    descriptorPath: string,
    identity: WindowsProcessIdentity,
    token: string,
  ) {
    this.lockPath = lockPath;
    this.descriptorPath = descriptorPath;
    this.identity = identity;
    this.token = token;
  }

  async publish(host: string, port: number): Promise<InstanceDescriptor> {
    const descriptor = { ...this.identity, token: this.token, host, port };
    const temporary = `${this.descriptorPath}.${this.token}.tmp`;
    await writeFile(temporary, JSON.stringify(descriptor, null, 2), "utf8");
    await rm(this.descriptorPath, { force: true });
    await rename(temporary, this.descriptorPath);
    return descriptor;
  }

  async release(): Promise<void> {
    const lock = await readJson(this.lockPath);
    const descriptor = await readJson(this.descriptorPath);
    if (
      validIdentity(lock) &&
      lock.token === this.token &&
      (!descriptor || (validIdentity(descriptor) && descriptor.token === this.token))
    ) {
      await removeIfTokenMatches(this.descriptorPath, this.token);
      await removeIfTokenMatches(this.lockPath, this.token);
    }
  }
}

export class InstanceCoordinator {
  private readonly lockPath: string;
  private readonly descriptorPath: string;
  private readonly inspector: WindowsProcessInspector;
  private readonly request: typeof fetch;
  private readonly executablePath: string;
  private readonly pid: number;
  private readonly startupWaitMs: number;
  private readonly pollMs: number;

  constructor(dataDir: string, options: InstanceCoordinatorOptions = {}) {
    this.lockPath = join(dataDir, "_app", "instance.lock");
    this.descriptorPath = join(dataDir, "_app", "instance.json");
    this.inspector = options.inspector ?? new CimWindowsProcessInspector();
    this.request = options.fetch ?? fetch;
    this.executablePath = options.executablePath ?? process.execPath;
    this.pid = options.pid ?? process.pid;
    this.startupWaitMs = options.startupWaitMs ?? 60_000;
    this.pollMs = options.pollMs ?? 250;
  }

  async acquire(): Promise<InstanceAcquisition> {
    const observedSelf = await this.inspector.observe(this.pid);
    if (!observedSelf) throw new Error("Could not determine this process start identity.");
    const identity: WindowsProcessIdentity = {
      pid: this.pid,
      executable: this.executablePath,
      startedAt: observedSelf.startedAt,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("hex");
      const lock: InstanceLock = { ...identity, token };
      try {
        const handle = await open(this.lockPath, "wx");
        await handle.writeFile(JSON.stringify(lock, null, 2), "utf8");
        await handle.close();
        return {
          owner: true,
          lease: new InstanceLease(this.lockPath, this.descriptorPath, identity, token),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      const existingLock = await readJson(this.lockPath);
      if (!validIdentity(existingLock)) {
        await rm(this.lockPath, { force: true });
        continue;
      }
      const observed = await this.inspector.observe(existingLock.pid).catch(() => null);
      if (!observed || !isSameWindowsProcess(existingLock, observed, 0)) {
        await removeIfTokenMatches(this.descriptorPath, existingLock.token);
        await removeIfTokenMatches(this.lockPath, existingLock.token);
        continue;
      }

      const deadline = Date.now() + this.startupWaitMs;
      do {
        const descriptor = await readJson(this.descriptorPath);
        if (
          validDescriptor(descriptor) &&
          descriptor.token === existingLock.token &&
          isSameWindowsProcess(
            existingLock,
            { ...descriptor, commandLine: "" },
            0,
          )
        ) {
          const url = portableUrl(descriptor.host, descriptor.port);
          const response = await this.request(`${url}/api/app/instance`, {
            headers: { "X-Anima-Instance-Token": descriptor.token },
            signal: AbortSignal.timeout(2_000),
          }).catch(() => null);
          if (response?.ok) return { owner: false, url };
        }
        if (Date.now() >= deadline) break;
        await delay(this.pollMs);
      } while (true);
      throw new Error(
        "Another Anima Studio process owns this data folder but has not finished starting.",
      );
    }
    throw new Error("Could not recover the stale Anima Studio instance lock.");
  }
}

export const instanceTesting = { validDescriptor, validIdentity, readJson };
