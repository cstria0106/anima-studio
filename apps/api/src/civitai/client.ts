import { CivitaiError } from "./errors";
import { parseCivitaiModelResponse } from "./parser";
import type {
  CivitaiModelInspection,
  CivitaiModelReference,
  SecretStore,
} from "./types";
import {
  CIVITAI_TOKEN_SECRET,
} from "./secrets";
import { parseCivitaiModelUrl } from "./url";

export const CIVITAI_API_BASE_URL = "https://civitai.red/api/v1";

const allowedApiHosts = new Set(["civitai.red", "civitai.com"]);
const maximumResponseBytes = 8 * 1_024 * 1_024;

export interface CivitaiHttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
}

export interface CivitaiHttpResponse {
  status: number;
  body: unknown;
}

export interface CivitaiHttpTransport {
  getJson(request: CivitaiHttpRequest): Promise<CivitaiHttpResponse>;
}

export interface CivitaiMetadataClient {
  inspect(
    source: string | CivitaiModelReference,
  ): Promise<CivitaiModelInspection>;
}

function validateApiUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CivitaiError(
      "REMOTE_UNAVAILABLE",
      "Civitai returned an invalid redirect.",
      502,
    );
  }
  if (
    url.protocol !== "https:" ||
    !allowedApiHosts.has(url.hostname.toLowerCase()) ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new CivitaiError(
      "REMOTE_UNAVAILABLE",
      "Civitai returned an unsafe redirect.",
      502,
    );
  }
  return url;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(
    response.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumResponseBytes
  ) {
    throw new CivitaiError(
      "REMOTE_UNAVAILABLE",
      "Civitai returned an unexpectedly large response.",
      502,
    );
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumResponseBytes) {
        throw new CivitaiError(
          "REMOTE_UNAVAILABLE",
          "Civitai returned an unexpectedly large response.",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CivitaiError(
      "REMOTE_UNAVAILABLE",
      "Civitai returned an invalid response.",
      502,
    );
  }
}

/**
 * Fetch implementation with manual, allowlisted redirects. This prevents a
 * compromised upstream redirect from turning the server into an SSRF client.
 */
export class FetchCivitaiHttpTransport
  implements CivitaiHttpTransport
{
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
    private readonly maximumRedirects = 2,
  ) {}

  async getJson(
    request: CivitaiHttpRequest,
  ): Promise<CivitaiHttpResponse> {
    let url = validateApiUrl(request.url);
    for (let redirect = 0; redirect <= this.maximumRedirects; redirect += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: request.headers,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (error instanceof CivitaiError) throw error;
        throw new CivitaiError(
          "REMOTE_UNAVAILABLE",
          "Civitai could not be reached.",
          502,
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === this.maximumRedirects) {
          throw new CivitaiError(
            "REMOTE_UNAVAILABLE",
            "Civitai returned too many redirects.",
            502,
          );
        }
        url = validateApiUrl(new URL(location, url).toString());
        continue;
      }
      return {
        status: response.status,
        body: await readLimitedJson(response),
      };
    }
    throw new CivitaiError(
      "REMOTE_UNAVAILABLE",
      "Civitai could not be reached.",
      502,
    );
  }
}

function responseError(status: number): CivitaiError {
  if (status === 401 || status === 403) {
    return new CivitaiError(
      "AUTH_REQUIRED",
      "Civitai authentication is required or the token is invalid.",
      401,
    );
  }
  if (status === 404) {
    return new CivitaiError(
      "NOT_FOUND",
      "The Civitai model was not found.",
      404,
    );
  }
  if (status === 429) {
    return new CivitaiError(
      "RATE_LIMITED",
      "Civitai is rate limiting requests. Try again later.",
      429,
    );
  }
  return new CivitaiError(
    "REMOTE_UNAVAILABLE",
    "Civitai could not return model metadata.",
    502,
  );
}

export class CivitaiApiClient implements CivitaiMetadataClient {
  constructor(
    private readonly transport: CivitaiHttpTransport =
      new FetchCivitaiHttpTransport(),
    private readonly secrets: SecretStore | null = null,
    private readonly tokenKey = CIVITAI_TOKEN_SECRET,
  ) {}

  async inspect(
    source: string | CivitaiModelReference,
  ): Promise<CivitaiModelInspection> {
    const reference =
      typeof source === "string" ? parseCivitaiModelUrl(source) : source;
    let token: string | null = null;
    if (this.secrets) {
      try {
        token = await this.secrets.read(this.tokenKey);
      } catch {
        throw new CivitaiError(
          "AUTH_REQUIRED",
          "The Civitai token store is unavailable.",
          503,
        );
      }
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "Portable-Anima-Studio/1",
    };
    if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;

    let response: CivitaiHttpResponse;
    try {
      response = await this.transport.getJson({
        url: `${CIVITAI_API_BASE_URL}/models/${reference.modelId}`,
        headers,
      });
    } catch (error) {
      if (error instanceof CivitaiError) throw error;
      // Do not surface arbitrary transport errors: they may contain request
      // headers or a reflected token.
      throw new CivitaiError(
        "REMOTE_UNAVAILABLE",
        "Civitai could not be reached.",
        502,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw responseError(response.status);
    }
    return parseCivitaiModelResponse(reference, response.body);
  }
}
