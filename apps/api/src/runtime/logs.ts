import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export type RuntimeLogSource = "stdout" | "stderr" | "supervisor";

export interface RuntimeLogEvent {
  cursor: number;
  sessionId: string;
  source: RuntimeLogSource;
  line: string;
  createdAt: string;
}

export interface RuntimeLogSubscription {
  close(): void;
}

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function redactRuntimeLog(
  value: string,
  secrets: Iterable<string> = [],
): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length >= 4) result = result.replaceAll(secret, "[REDACTED]");
  }
  result = result
    .replace(
      /(\bauthorization\b\s*[:=]\s*)(?:bearer\s+)?[^\s,;}"']+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:civitai[_-]?)?(?:api[_-]?key|token)\b\s*[:=]\s*)[^\s,;}"']+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["'](?:authorization|api[_-]?key|token)["']\s*:\s*["'])[^"']*(["'])/gi,
      "$1[REDACTED]$2",
    )
    .replace(
      /([?&](?:token|api[_-]?key)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );
  return result;
}

export interface RuntimeLogServiceOptions {
  directory: string;
  maxFileBytes?: number;
  retainedFiles?: number;
  now?: () => Date;
}

export class RuntimeLogService {
  private readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly retainedFiles: number;
  private readonly now: () => Date;
  private readonly listeners = new Set<(event: RuntimeLogEvent) => void>();
  private readonly secrets = new Set<string>();
  private cursor: number;
  private writeChain = Promise.resolve();

  constructor(options: RuntimeLogServiceOptions) {
    this.directory = options.directory;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.retainedFiles = options.retainedFiles ?? 10;
    this.now = options.now ?? (() => new Date());
    this.cursor = this.now().getTime() * 1_000;
    if (this.maxFileBytes < 1) {
      throw new Error("maxFileBytes must be positive.");
    }
    if (this.retainedFiles < 1) {
      throw new Error("retainedFiles must be positive.");
    }
  }

  get latestCursor(): number {
    return this.cursor;
  }

  addSecret(secret: string): () => void {
    if (secret.length >= 4) this.secrets.add(secret);
    return () => this.secrets.delete(secret);
  }

  private assertSessionId(sessionId: string): void {
    if (!SESSION_ID.test(sessionId)) {
      throw new Error("Runtime log session ID contains unsupported characters.");
    }
  }

  private path(sessionId: string, suffix = ""): string {
    this.assertSessionId(sessionId);
    return join(this.directory, `${sessionId}.log${suffix}`);
  }

  private async rotate(sessionId: string, incomingBytes: number): Promise<void> {
    const current = this.path(sessionId);
    let currentBytes = 0;
    try {
      currentBytes = (await stat(current)).size;
    } catch {
      return;
    }
    if (currentBytes + incomingBytes <= this.maxFileBytes) return;

    const lastSuffix = this.retainedFiles - 1;
    if (lastSuffix > 0) {
      await unlink(this.path(sessionId, `.${lastSuffix}`)).catch(() => {});
      for (let index = lastSuffix - 1; index >= 1; index -= 1) {
        await rename(
          this.path(sessionId, `.${index}`),
          this.path(sessionId, `.${index + 1}`),
        ).catch(() => {});
      }
      await rename(current, this.path(sessionId, ".1")).catch(() => {});
    } else {
      await unlink(current).catch(() => {});
    }
  }

  append(
    sessionId: string,
    source: RuntimeLogSource,
    line: string,
  ): Promise<RuntimeLogEvent> {
    const task = this.writeChain.then(async () => {
      this.assertSessionId(sessionId);
      await mkdir(this.directory, { recursive: true });
      const createdAt = this.now().toISOString();
      let redacted = redactRuntimeLog(line.replace(/[\r\n]+$/g, ""), this.secrets);
      let encoded = new TextEncoder().encode(
        `${createdAt} [${source}] ${redacted}\n`,
      );
      if (encoded.byteLength > this.maxFileBytes) {
        const marker = "[truncated] ";
        const available = Math.max(
          0,
          this.maxFileBytes -
            new TextEncoder().encode(
              `${createdAt} [${source}] ${marker}\n`,
            ).byteLength,
        );
        const tail = encoded.slice(Math.max(0, encoded.byteLength - available));
        redacted = `${marker}${new TextDecoder().decode(tail).trimEnd()}`;
        encoded = new TextEncoder().encode(
          `${createdAt} [${source}] ${redacted}\n`,
        );
      }
      await this.rotate(sessionId, encoded.byteLength);
      await writeFile(this.path(sessionId), encoded, { flag: "a" });
      const event: RuntimeLogEvent = {
        cursor: (this.cursor = Math.max(
          this.cursor + 1,
          this.now().getTime() * 1_000,
        )),
        sessionId,
        source,
        line: redacted,
        createdAt,
      };
      for (const listener of this.listeners) listener(event);
      return event;
    });
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /**
   * Pumps a child-process stream without assuming chunk boundaries are lines.
   */
  async attach(
    sessionId: string,
    source: Exclude<RuntimeLogSource, "supervisor">,
    stream: ReadableStream<Uint8Array> | null,
  ): Promise<void> {
    if (!stream) return;
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let pending = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) await this.append(sessionId, source, line);
    }
    pending += decoder.decode();
    if (pending) await this.append(sessionId, source, pending);
  }

  subscribe(
    listener: (event: RuntimeLogEvent) => void,
  ): RuntimeLogSubscription {
    this.listeners.add(listener);
    return { close: () => this.listeners.delete(listener) };
  }

  async readTail(
    sessionId: string,
    maxBytes = 256 * 1024,
  ): Promise<string> {
    this.assertSessionId(sessionId);
    const chunks: Uint8Array[] = [];
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
      try {
        chunks.push(await readFile(this.path(sessionId, `.${index}`)));
      } catch {
        // Missing rotations are expected.
      }
    }
    try {
      chunks.push(await readFile(this.path(sessionId)));
    } catch {
      return "";
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(
      combined.slice(Math.max(0, combined.byteLength - Math.max(1, maxBytes))),
    );
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
