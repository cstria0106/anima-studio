import { describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import {
  CivitaiApiClient,
  FetchCivitaiHttpTransport,
  type CivitaiHttpRequest,
  type CivitaiHttpResponse,
  type CivitaiHttpTransport,
} from "./client";
import { DestinationRegistry } from "./destinations";
import {
  DpapiFileSecretStore,
  type CurrentUserDataProtector,
} from "./dpapi-secrets";
import { CivitaiError } from "./errors";
import {
  ANIMA_LORA_MANAGER_CONTRACT,
  PinnedLoraManagerClient,
  type LoraManagerDownloadPayload,
  type LoraManagerTransport,
} from "./lora-manager";
import {
  CivitaiTokenService,
  ManagedLoraManagerCredentialLease,
  SAFE_LORA_MANAGER_SECRET_CONTRACT,
} from "./secrets";
import type {
  CivitaiFileInspection,
  SecretStore,
} from "./types";
import { parseCivitaiModelUrl } from "./url";

const validSha = "a".repeat(64);
const reflectedSecret = "secret-token-never-return-this";

class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, secret: string): Promise<void> {
    this.values.set(key, secret);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

function modelResponse(): Record<string, unknown> {
  return {
    id: 123,
    name: "Character LoRA",
    type: "LORA",
    nsfw: true,
    creator: { username: "creator" },
    tags: ["character", "anime", "character"],
    allowNoCredit: false,
    allowCommercialUse: ["Image"],
    allowDerivatives: true,
    allowDifferentLicense: false,
    modelVersions: [
      {
        id: 456,
        name: "v1",
        baseModel: "Illustrious",
        trainedWords: ["trigger", "trigger"],
        images: [
          {
            type: "video",
            url: "https://image.civitai.com/preview.mp4",
          },
          {
            type: "image",
            url: "https://cdn.example.test/untrusted.jpeg",
          },
          {
            type: "image",
            url: "http://image.civitai.com/insecure.jpeg",
          },
          {
            type: "image",
            url: "https://token@image.civitai.com/credential.jpeg",
          },
          {
            type: "image",
            url: "https://image.civitai.com/v1.jpeg",
          },
        ],
        files: [
          {
            id: 10,
            name: "character.safetensors",
            type: "Model",
            primary: true,
            sizeKB: 2,
            metadata: {
              format: "SafeTensor",
              size: "full",
              fp: "fp16",
            },
            hashes: { SHA256: validSha },
            pickleScanResult: "Success",
            virusScanResult: "Success",
          },
          {
            id: 11,
            name: "unsafe.pkl",
            type: "Model",
            hashes: { SHA256: "b".repeat(64) },
          },
          {
            id: 12,
            name: "../escape.safetensors",
            type: "Model",
            hashes: { SHA256: "c".repeat(64) },
          },
          {
            id: 13,
            name: "training.safetensors",
            type: "Training Data",
            hashes: { SHA256: "d".repeat(64) },
          },
        ],
      },
      {
        id: 789,
        name: "v2",
        images: [
          {
            type: "image",
            url: "https://image.civitai.red/v2.webp",
          },
        ],
        files: [],
      },
    ],
  };
}

describe("Civitai model URL boundary", () => {
  test("accepts canonical .com and .red model URLs", () => {
    expect(
      parseCivitaiModelUrl(
        "https://civitai.com/models/123/a-model?modelVersionId=456",
      ),
    ).toEqual({
      provider: "civitai",
      host: "civitai.com",
      modelId: 123,
      modelVersionId: 456,
      canonicalUrl:
        "https://civitai.com/models/123?modelVersionId=456",
      unrestrictedSource: false,
    });
    expect(
      parseCivitaiModelUrl("https://civitai.red/models/123"),
    ).toMatchObject({
      host: "civitai.red",
      modelId: 123,
      unrestrictedSource: true,
    });
  });

  test("rejects lookalike hosts, credentials, HTTP and unrelated paths", () => {
    const rejected = [
      "https://civitai.com.evil.test/models/123",
      "https://civitai.com@evil.test/models/123",
      "https://token@civitai.com/models/123",
      "http://civitai.com/models/123",
      "https://www.civitai.com/models/123",
      "https://civitai.com/api/v1/models/123",
      "https://civitai.com/models/123?other=1",
      "https://civitai.com/models/123?modelVersionId=1&modelVersionId=2",
    ];
    for (const url of rejected) {
      expect(() => parseCivitaiModelUrl(url)).toThrow(CivitaiError);
    }
  });
});

describe("Civitai metadata client", () => {
  test("uses the fixed API host, filters unsafe files and never returns its token", async () => {
    const secrets = new MemorySecretStore();
    const tokenService = new CivitaiTokenService(secrets);
    expect(await tokenService.configure(reflectedSecret)).toEqual({
      tokenConfigured: true,
    });

    const requests: CivitaiHttpRequest[] = [];
    const transport: CivitaiHttpTransport = {
      async getJson(request): Promise<CivitaiHttpResponse> {
        requests.push(request);
        return { status: 200, body: modelResponse() };
      },
    };
    const client = new CivitaiApiClient(transport, secrets);
    const inspection = await client.inspect(
      "https://civitai.com/models/123?modelVersionId=456",
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://civitai.red/api/v1/models/123",
    );
    expect(requests[0]?.headers.authorization).toBe(
      `Bearer ${reflectedSecret}`,
    );
    expect(inspection.versions).toHaveLength(1);
    expect(inspection.versions[0]?.thumbnailUrl).toBe(
      "https://image.civitai.com/v1.jpeg",
    );
    expect(
      inspection.versions[0]?.files.map(
        ({ name, eligible, blockReason }) => ({
          name,
          eligible,
          blockReason,
        }),
      ),
    ).toEqual([
      {
        name: "character.safetensors",
        eligible: true,
        blockReason: null,
      },
      {
        name: "unsafe.pkl",
        eligible: false,
        blockReason: "not_safetensors",
      },
      {
        name: "Unsafe filename",
        eligible: false,
        blockReason: "unsafe_filename",
      },
      {
        name: "training.safetensors",
        eligible: false,
        blockReason: "unsupported_file_type",
      },
    ]);
    expect(JSON.stringify(inspection)).not.toContain(reflectedSecret);
    expect(await tokenService.status()).toEqual({
      tokenConfigured: true,
    });
    expect(JSON.stringify(await tokenService.clear())).not.toContain(
      reflectedSecret,
    );
  });

  test("keeps a distinct first safe preview for every model version", async () => {
    const client = new CivitaiApiClient({
      async getJson(): Promise<CivitaiHttpResponse> {
        return { status: 200, body: modelResponse() };
      },
    });

    const inspection = await client.inspect(
      "https://civitai.com/models/123",
    );

    expect(
      inspection.versions.map((version) => ({
        id: version.id,
        thumbnailUrl: version.thumbnailUrl,
      })),
    ).toEqual([
      {
        id: 456,
        thumbnailUrl: "https://image.civitai.com/v1.jpeg",
      },
      {
        id: 789,
        thumbnailUrl: "https://image.civitai.red/v2.webp",
      },
    ]);
  });

  test("does not reflect remote bodies or thrown transport errors", async () => {
    const bodyClient = new CivitaiApiClient({
      async getJson() {
        return {
          status: 401,
          body: { error: reflectedSecret },
        };
      },
    });
    const bodyError = await bodyClient
      .inspect("https://civitai.com/models/123")
      .catch((error: unknown) => error);
    expect(String(bodyError)).not.toContain(reflectedSecret);
    expect(bodyError).toBeInstanceOf(CivitaiError);

    const thrownClient = new CivitaiApiClient({
      async getJson() {
        throw new Error(reflectedSecret);
      },
    });
    const thrownError = await thrownClient
      .inspect("https://civitai.com/models/123")
      .catch((error: unknown) => error);
    expect(String(thrownError)).not.toContain(reflectedSecret);
  });

  test("blocks redirects away from the two pinned Civitai hosts", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    }) as typeof fetch;
    const transport = new FetchCivitaiHttpTransport(fetcher);
    const error = await transport
      .getJson({
        url: "https://civitai.red/api/v1/models/123",
        headers: {},
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CivitaiError);
    expect((error as CivitaiError).message).toContain("unsafe redirect");
    expect(calls).toHaveLength(1);
  });
});

describe("DPAPI secret boundary", () => {
  test("persists only protected bytes and gives HTTP facades write-only status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anima-dpapi-"));
    const protector: CurrentUserDataProtector = {
      async protect(plain) {
        return Uint8Array.from(plain, (byte) => byte ^ 0xa5);
      },
      async unprotect(protectedBytes) {
        return Uint8Array.from(
          protectedBytes,
          (byte) => byte ^ 0xa5,
        );
      },
    };
    try {
      const store = new DpapiFileSecretStore(
        directory,
        protector,
      );
      const tokens = new CivitaiTokenService(store);
      expect(await tokens.configure(reflectedSecret)).toEqual({
        tokenConfigured: true,
      });
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).not.toContain(reflectedSecret);
      expect(
        (await readFile(join(directory, files[0]!))).toString(
          "utf8",
        ),
      ).not.toContain(reflectedSecret);
      expect(JSON.stringify(await tokens.status())).not.toContain(
        reflectedSecret,
      );

      const lease = new ManagedLoraManagerCredentialLease(store);
      let observed = "";
      await lease.withEnvironment(
        SAFE_LORA_MANAGER_SECRET_CONTRACT,
        {},
        (environment) => {
          observed = environment.CIVITAI_API_KEY ?? "";
        },
      );
      expect(observed).toBe(reflectedSecret);
      await expect(
        lease.withEnvironment("unpatched", {}, () => undefined),
      ).rejects.toThrow("cannot receive a token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("managed destinations", () => {
  test("exposes root IDs without paths and rejects traversal or a kind mismatch", () => {
    const root = resolve("C:/managed/models/loras");
    const destinations = new DestinationRegistry([
      {
        id: "loras",
        label: "LoRA",
        kind: "loras",
        absolutePath: root,
      },
    ]);
    expect(destinations.options()).toEqual([
      { id: "loras", label: "LoRA", kind: "loras" },
    ]);
    expect(JSON.stringify(destinations.options())).not.toContain(root);
    expect(() =>
      destinations.resolve("loras", "lora", "../outside"),
    ).toThrow(CivitaiError);
    expect(() =>
      destinations.resolve("loras", "checkpoint"),
    ).toThrow(CivitaiError);
    expect(() =>
      destinations.assertFinalFile(
        destinations.resolve("loras", "lora"),
        resolve(root, "../outside/model.safetensors"),
      ),
    ).toThrow(CivitaiError);
  });
});

class RecordingManagerTransport implements LoraManagerTransport {
  payload: LoraManagerDownloadPayload | null = null;
  controls: string[] = [];
  response: CivitaiHttpResponse = {
    status: 200,
    body: {
      success: true,
      download_id: "download_1",
      contract_version: ANIMA_LORA_MANAGER_CONTRACT,
      path:
        "C:/managed/models/loras/character.safetensors",
    },
  };

  async download(
    payload: LoraManagerDownloadPayload,
  ): Promise<CivitaiHttpResponse> {
    this.payload = payload;
    return this.response;
  }

  async progress(): Promise<CivitaiHttpResponse> {
    return {
      status: 200,
      body: {
        success: true,
        status: "progress",
        progress: 32.5,
        bytes_downloaded: 100,
        total_bytes: 200,
        bytes_per_second: 25,
      },
    };
  }

  async pause(): Promise<CivitaiHttpResponse> {
    this.controls.push("pause");
    return { status: 200, body: { success: true } };
  }

  async resume(): Promise<CivitaiHttpResponse> {
    this.controls.push("resume");
    return { status: 200, body: { success: true } };
  }

  async cancel(): Promise<CivitaiHttpResponse> {
    this.controls.push("cancel");
    return { status: 200, body: { success: true } };
  }
}

describe("pinned LoRA Manager facade", () => {
  test("serializes only the managed download contract and exposes safe progress", async () => {
    const transport = new RecordingManagerTransport();
    const client = new PinnedLoraManagerClient(transport);
    const file: CivitaiFileInspection = {
      id: 10,
      name: "character.safetensors",
      sizeBytes: 2_048,
      remoteType: "Model",
      format: "SafeTensor",
      precision: "fp16",
      sizeVariant: "full",
      primary: true,
      sha256: validSha,
      eligible: true,
      blockReason: null,
    };
    const destination = {
      rootId: "loras",
      kind: "loras" as const,
      absoluteRoot: resolve("C:/managed/models/loras"),
      absoluteDirectory: resolve("C:/managed/models/loras"),
      relativeDirectory: "",
    };
    expect(
      await client.download({
        downloadId: "download_1",
        modelId: 123,
        versionId: 456,
        modelKind: "lora",
        file,
        destination,
      }),
    ).toEqual({
      downloadId: "download_1",
      finalPath: "C:/managed/models/loras/character.safetensors",
      expectedSha256: null,
      actualSha256: null,
    });
    expect(transport.payload).toEqual({
      contract_version: ANIMA_LORA_MANAGER_CONTRACT,
      model_id: 123,
      model_version_id: 456,
      model_root: destination.absoluteDirectory,
      relative_path: "",
      use_default_paths: false,
      download_id: "download_1",
      source: "civitai",
      expected_sha256: validSha,
      allowed_extension: ".safetensors",
      destination_root_id: "loras",
      file_params: {
        id: 10,
        name: "character.safetensors",
        type: "Model",
        format: "SafeTensor",
        size: "full",
        fp: "fp16",
        isPrimary: true,
      },
    });
    expect(await client.getProgress("download_1")).toEqual({
      downloadId: "download_1",
      state: "downloading",
      percent: 32.5,
      bytesDownloaded: 100,
      totalBytes: 200,
      bytesPerSecond: 25,
    });
    await client.pause("download_1");
    await client.resume("download_1");
    await client.cancel("download_1");
    expect(transport.controls).toEqual(["pause", "resume", "cancel"]);
  });

  test("requires a matching terminal download ID and never reflects LoRA Manager errors", async () => {
    const transport = new RecordingManagerTransport();
    transport.response = {
      status: 500,
      body: { error: reflectedSecret },
    };
    const client = new PinnedLoraManagerClient(transport);
    const error = await client
      .download({
        downloadId: "download_1",
        modelId: 123,
        versionId: 456,
        modelKind: "lora",
        file: {
          id: 10,
          name: "character.safetensors",
          sizeBytes: 2_048,
          remoteType: "Model",
          format: "SafeTensor",
          precision: null,
          sizeVariant: null,
          primary: true,
          sha256: validSha,
          eligible: true,
          blockReason: null,
        },
        destination: {
          rootId: "loras",
          kind: "loras",
          absoluteRoot: resolve("C:/managed/models/loras"),
          absoluteDirectory: resolve("C:/managed/models/loras"),
          relativeDirectory: "",
        },
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CivitaiError);
    expect(String(error)).not.toContain(reflectedSecret);

    transport.response = {
      status: 200,
      body: {
        success: true,
        download_id: "different_download",
        contract_version: ANIMA_LORA_MANAGER_CONTRACT,
        path: "C:/managed/models/loras/character.safetensors",
      },
    };
    const mismatch = await client
      .download({
        downloadId: "download_1",
        modelId: 123,
        versionId: 456,
        modelKind: "lora",
        file: {
          id: 10,
          name: "character.safetensors",
          sizeBytes: 2_048,
          remoteType: "Model",
          format: "SafeTensor",
          precision: null,
          sizeVariant: null,
          primary: true,
          sha256: validSha,
          eligible: true,
          blockReason: null,
        },
        destination: {
          rootId: "loras",
          kind: "loras",
          absoluteRoot: resolve("C:/managed/models/loras"),
          absoluteDirectory: resolve("C:/managed/models/loras"),
          relativeDirectory: "",
        },
      })
      .catch((caught: unknown) => caught);
    expect(mismatch).toBeInstanceOf(CivitaiError);
    expect((mismatch as CivitaiError).code).toBe(
      "INCOMPATIBLE_LORA_MANAGER",
    );

    transport.response = {
      status: 200,
      body: {
        success: true,
        download_id: "download_1",
      },
    };
    const stockResponse = await client
      .download({
        downloadId: "download_1",
        modelId: 123,
        versionId: 456,
        modelKind: "lora",
        file: {
          id: 10,
          name: "character.safetensors",
          sizeBytes: 2_048,
          remoteType: "Model",
          format: "SafeTensor",
          precision: null,
          sizeVariant: null,
          primary: true,
          sha256: validSha,
          eligible: true,
          blockReason: null,
        },
        destination: {
          rootId: "loras",
          kind: "loras",
          absoluteRoot: resolve("C:/managed/models/loras"),
          absoluteDirectory: resolve("C:/managed/models/loras"),
          relativeDirectory: "",
        },
      })
      .catch((caught: unknown) => caught);
    expect(stockResponse).toBeInstanceOf(CivitaiError);
    expect((stockResponse as CivitaiError).code).toBe(
      "INCOMPATIBLE_LORA_MANAGER",
    );
  });
});
