import { CIVITAI_API_KEY_REQUIRED_MESSAGE } from "@anima/shared";

import { CivitaiError } from "./errors";
import type {
  CivitaiTokenStatus,
  SecretStore,
} from "./types";

export const CIVITAI_TOKEN_SECRET = "civitai.api-token";

const maximumTokenLength = 2_048;

export async function readRequiredCivitaiToken(
  secrets: SecretStore,
  key = CIVITAI_TOKEN_SECRET,
): Promise<string> {
  let token: string | null;
  try {
    token = await secrets.read(key);
  } catch {
    throw new CivitaiError(
      "AUTH_REQUIRED",
      "The Civitai token store is unavailable.",
      503,
    );
  }
  const normalized = token?.trim();
  if (!normalized) {
    throw new CivitaiError(
      "AUTH_REQUIRED",
      CIVITAI_API_KEY_REQUIRED_MESSAGE,
      401,
    );
  }
  return normalized;
}

/**
 * Write-only facade used by HTTP routes. It deliberately exposes status rather
 * than a token getter; trusted clients such as CivitaiApiClient read the
 * underlying SecretStore directly.
 */
export class CivitaiTokenService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly key = CIVITAI_TOKEN_SECRET,
  ) {}

  async status(): Promise<CivitaiTokenStatus> {
    return { tokenConfigured: await this.secrets.has(this.key) };
  }

  async requireConfigured(): Promise<void> {
    await readRequiredCivitaiToken(this.secrets, this.key);
  }

  async configure(token: string): Promise<CivitaiTokenStatus> {
    const normalized = token.trim();
    if (
      normalized.length < 8 ||
      normalized.length > maximumTokenLength ||
      /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
      throw new CivitaiError(
        "AUTH_REQUIRED",
        "The Civitai token is not valid.",
        400,
      );
    }
    await this.secrets.write(this.key, normalized);
    return { tokenConfigured: true };
  }

  async clear(): Promise<CivitaiTokenStatus> {
    await this.secrets.remove(this.key);
    return { tokenConfigured: false };
  }
}
