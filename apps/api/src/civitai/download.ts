import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ArtifactIntegrityError,
  FileDownloadHttpError,
  VerifiedResumableFileDownloader,
  type VerifiedFileDownloader,
} from "../runtime";
import { CivitaiError, assertCivitai } from "./errors";
import { CIVITAI_TOKEN_SECRET } from "./secrets";
import type {
  CivitaiFileInspection,
  CivitaiModelKind,
  ModelDownloadProgress,
  ResolvedDestination,
  SecretStore,
} from "./types";

export interface CivitaiDownloadInput {
  downloadId: string;
  modelId: number;
  versionId: number;
  modelKind: CivitaiModelKind;
  file: CivitaiFileInspection;
  destination: ResolvedDestination;
  signal?: AbortSignal;
  onProgress?(progress: ModelDownloadProgress): void;
}

export interface CivitaiDownloadCompletion {
  downloadId: string;
  finalPath: string;
  expectedSha256: string | null;
  actualSha256: string | null;
}

export interface CivitaiDownloadClient {
  download(input: CivitaiDownloadInput): Promise<CivitaiDownloadCompletion>;
  getProgress(downloadId: string): Promise<ModelDownloadProgress>;
  pause(downloadId: string): Promise<void>;
  resume(downloadId: string): Promise<void>;
  cancel(downloadId: string): Promise<void>;
}

interface DirectDownloadSession {
  id: string;
  filename: string;
  directory: string;
  state: "queued" | "downloading" | "paused" | "cancelled";
  bytesDownloaded: number;
  totalBytes: number;
  bytesPerSecond: number;
  paused: boolean;
  cancelled: boolean;
  interruption: "pause" | "cancel" | "external" | null;
  transfer: AbortController | null;
  wake: (() => void) | null;
  sampleBytes: number;
  sampleAt: number;
  onProgress?: (progress: ModelDownloadProgress) => void;
}

function sessionProgress(
  session: DirectDownloadSession,
): ModelDownloadProgress {
  return {
    downloadId: session.id,
    state: session.state,
    percent:
      session.totalBytes > 0
        ? Math.min(100, (session.bytesDownloaded / session.totalBytes) * 100)
        : 0,
    bytesDownloaded: session.bytesDownloaded,
    totalBytes: session.totalBytes,
    bytesPerSecond: session.bytesPerSecond,
  };
}

function notifyProgress(session: DirectDownloadSession): void {
  try {
    session.onProgress?.(sessionProgress(session));
  } catch {
    // Progress observers are advisory and cannot fail the transfer.
  }
}

function cancelledError(): Error {
  return new DOMException("The model download was cancelled.", "AbortError");
}

function safeDownloadFailure(error: unknown): CivitaiError | Error {
  if (error instanceof CivitaiError) return error;
  if (error instanceof FileDownloadHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new CivitaiError(
        "AUTH_REQUIRED",
        "Civitai authentication is required or the token is invalid.",
        401,
      );
    }
    if (error.status === 429) {
      return new CivitaiError(
        "RATE_LIMITED",
        "Civitai is rate limiting requests. Try again later.",
        429,
      );
    }
    return new CivitaiError(
      "DOWNLOAD_FAILED",
      "Civitai could not download the selected model file.",
      502,
    );
  }
  if (error instanceof ArtifactIntegrityError) {
    return new CivitaiError("HASH_MISMATCH", error.message, 502);
  }
  return error instanceof Error
    ? error
    : new CivitaiError(
        "DOWNLOAD_FAILED",
        "The model download failed.",
        500,
      );
}

export class DirectCivitaiDownloadClient implements CivitaiDownloadClient {
  private readonly sessions = new Map<string, DirectDownloadSession>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly files: VerifiedFileDownloader =
      new VerifiedResumableFileDownloader(),
    private readonly tokenKey = CIVITAI_TOKEN_SECRET,
    private readonly now = () => Date.now(),
  ) {}

  async download(
    input: CivitaiDownloadInput,
  ): Promise<CivitaiDownloadCompletion> {
    assertCivitai(
      !this.sessions.has(input.downloadId),
      "DOWNLOAD_FAILED",
      "This model download is already active.",
      409,
    );
    assertCivitai(
      input.file.eligible &&
        input.file.id !== null &&
        input.file.sha256 !== null &&
        input.file.downloadUrl !== null &&
        input.file.sizeBytes !== null &&
        input.file.sizeBytes > 0,
      "UNSUPPORTED_FILE",
      "The selected Civitai file cannot be downloaded safely.",
      400,
    );

    let token: string | null;
    try {
      token = await this.secrets.read(this.tokenKey);
    } catch {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token store is unavailable.",
        503,
      );
    }

    const session: DirectDownloadSession = {
      id: input.downloadId,
      filename: input.file.name,
      directory: input.destination.absoluteDirectory,
      state: "queued",
      bytesDownloaded: 0,
      totalBytes: input.file.sizeBytes,
      bytesPerSecond: 0,
      paused: false,
      cancelled: false,
      interruption: null,
      transfer: null,
      wake: null,
      sampleBytes: 0,
      sampleAt: this.now(),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    };
    this.sessions.set(session.id, session);

    const externalAbort = () => {
      session.interruption = "external";
      session.transfer?.abort(input.signal?.reason);
      session.wake?.();
    };
    input.signal?.addEventListener("abort", externalAbort, { once: true });

    try {
      while (true) {
        if (input.signal?.aborted) throw input.signal.reason ?? cancelledError();
        if (session.cancelled) throw cancelledError();
        if (session.paused) {
          await new Promise<void>((resolve) => {
            session.wake = resolve;
          });
          session.wake = null;
          continue;
        }

        session.state = "downloading";
        session.transfer = new AbortController();
        try {
          const finalPath = await this.files.download(
            {
              id: `civitai:${input.modelId}:${input.versionId}:${input.file.id}`,
              downloadUrl: input.file.downloadUrl,
              filename: input.file.name,
              bytes: input.file.sizeBytes,
              sha256: input.file.sha256,
              ...(token
                ? { headers: { authorization: `Bearer ${token}` } }
                : {}),
            },
            input.destination.absoluteDirectory,
            {
              signal: session.transfer.signal,
              onProgress: (progress) => {
                const sampledAt = this.now();
                const elapsed = sampledAt - session.sampleAt;
                let shouldNotify =
                  progress.currentBytes >= progress.totalBytes;
                if (elapsed >= 250) {
                  session.bytesPerSecond = Math.max(
                    0,
                    Math.round(
                      ((progress.currentBytes - session.sampleBytes) * 1_000) /
                        elapsed,
                    ),
                  );
                  session.sampleAt = sampledAt;
                  session.sampleBytes = progress.currentBytes;
                  shouldNotify = true;
                }
                session.bytesDownloaded = progress.currentBytes;
                session.totalBytes = progress.totalBytes;
                if (shouldNotify) notifyProgress(session);
              },
            },
          );
          session.bytesDownloaded = input.file.sizeBytes;
          session.bytesPerSecond = 0;
          notifyProgress(session);
          return {
            downloadId: input.downloadId,
            finalPath,
            expectedSha256: input.file.sha256,
            actualSha256: input.file.sha256,
          };
        } catch (error) {
          const interruption = session.interruption;
          session.interruption = null;
          if (interruption === "pause") continue;
          if (interruption === "cancel" || session.cancelled) {
            await rm(
              `${join(session.directory, session.filename)}.part`,
              { force: true },
            ).catch(() => undefined);
            throw cancelledError();
          }
          if (interruption === "external" || input.signal?.aborted) {
            throw input.signal?.reason ?? error;
          }
          throw safeDownloadFailure(error);
        } finally {
          session.transfer = null;
        }
      }
    } finally {
      input.signal?.removeEventListener("abort", externalAbort);
      this.sessions.delete(session.id);
    }
  }

  async getProgress(downloadId: string): Promise<ModelDownloadProgress> {
    return sessionProgress(this.session(downloadId));
  }

  async pause(downloadId: string): Promise<void> {
    const session = this.session(downloadId);
    session.paused = true;
    session.state = "paused";
    session.bytesPerSecond = 0;
    if (session.transfer) {
      session.interruption = "pause";
      session.transfer.abort(cancelledError());
    }
    notifyProgress(session);
  }

  async resume(downloadId: string): Promise<void> {
    const session = this.session(downloadId);
    assertCivitai(
      session.paused,
      "DOWNLOAD_FAILED",
      "The model download is not paused.",
      409,
    );
    session.paused = false;
    session.state = "downloading";
    session.wake?.();
    notifyProgress(session);
  }

  async cancel(downloadId: string): Promise<void> {
    const session = this.session(downloadId);
    session.cancelled = true;
    session.state = "cancelled";
    session.bytesPerSecond = 0;
    session.interruption = "cancel";
    session.transfer?.abort(cancelledError());
    session.wake?.();
    notifyProgress(session);
  }

  private session(downloadId: string): DirectDownloadSession {
    const session = this.sessions.get(downloadId);
    if (!session) {
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The active model download was not found.",
        404,
      );
    }
    return session;
  }
}
