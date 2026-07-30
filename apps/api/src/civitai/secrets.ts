import { CivitaiError } from "./errors";
import type {
  CivitaiTokenStatus,
  SecretStore,
} from "./types";

export const CIVITAI_TOKEN_SECRET = "civitai.api-token";
export const CIVITAI_LORA_MANAGER_ENVIRONMENT_KEY =
  "CIVITAI_API_KEY";
export const SAFE_LORA_MANAGER_SECRET_CONTRACT =
  "anima-lora-manager-env-secret-v1";

const maximumTokenLength = 2_048;

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

/**
 * Trusted runtime-only bridge for the managed LoRA Manager patch.
 *
 * The stock 1.0.6 settings manager copies CIVITAI_API_KEY into settings.json,
 * so callers must only use this bridge after applying and validating the
 * `anima-lora-manager-env-secret-v1` patch, which keeps the environment value
 * in memory. Token changes take effect after the managed process is restarted.
 */
export class ManagedLoraManagerCredentialLease {
  constructor(
    private readonly secrets: SecretStore,
    private readonly key = CIVITAI_TOKEN_SECRET,
  ) {}

  async withEnvironment<T>(
    verifiedContract: string,
    baseEnvironment: Readonly<NodeJS.ProcessEnv>,
    start: (environment: NodeJS.ProcessEnv) => Promise<T> | T,
  ): Promise<T> {
    if (verifiedContract !== SAFE_LORA_MANAGER_SECRET_CONTRACT) {
      throw new CivitaiError(
        "INCOMPATIBLE_LORA_MANAGER",
        "LoRA Manager cannot receive a token until its in-memory secret contract is verified.",
        503,
      );
    }
    const token = await this.secrets.read(this.key);
    const environment: NodeJS.ProcessEnv = {
      ...baseEnvironment,
    };
    if (token) {
      environment[CIVITAI_LORA_MANAGER_ENVIRONMENT_KEY] = token;
    } else {
      delete environment[CIVITAI_LORA_MANAGER_ENVIRONMENT_KEY];
    }
    try {
      return await start(environment);
    } finally {
      delete environment[CIVITAI_LORA_MANAGER_ENVIRONMENT_KEY];
    }
  }
}
