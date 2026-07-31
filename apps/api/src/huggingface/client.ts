import { basename } from "node:path";

import {
  type HuggingFaceAnimaCatalogDto,
  type HuggingFaceAnimaFileDto,
  type ModelDestinationKind,
} from "@anima/shared";
import { z } from "zod";

import {
  HuggingFaceError,
  assertHuggingFace,
} from "./errors";

export const HUGGING_FACE_ANIMA_REPOSITORY =
  "circlestone-labs/Anima" as const;
export const HUGGING_FACE_ANIMA_SOURCE_URL =
  `https://huggingface.co/${HUGGING_FACE_ANIMA_REPOSITORY}`;
export const HUGGING_FACE_ANIMA_LICENSE =
  "circlestone-labs-non-commercial-license";

const modelSchema = z
  .object({
    id: z.string(),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    private: z.boolean().default(false),
    gated: z.union([z.boolean(), z.string()]).optional(),
    lastModified: z.string().nullable().optional(),
  })
  .passthrough();

const treeEntrySchema = z
  .object({
    type: z.string(),
    oid: z.string(),
    // Hugging Face includes directory entries with size 0 in recursive tree
    // responses. Supported model files are validated as positive LFS objects
    // below, after non-model entries have been filtered out.
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    path: z.string().min(1).max(512),
    lfs: z
      .object({
        oid: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const treeSchema = z.array(treeEntrySchema).max(10_000);
const safeFilename = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,239}\.safetensors$/;
const supportedPath =
  /^split_files\/(diffusion_models|text_encoders|vae)\/([^/]+\.safetensors)$/;

export interface HuggingFaceJsonTransport {
  json(url: string): Promise<unknown>;
}

export class FetchHuggingFaceJsonTransport
  implements HuggingFaceJsonTransport
{
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
    private readonly maxResponseBytes = 2 * 1024 * 1024,
  ) {}

  async json(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HuggingFaceError(
        "CATALOG_UNAVAILABLE",
        "Hugging Face의 Anima 모델 목록에 연결하지 못했습니다.",
        502,
      );
    }
    if (!response.ok) {
      throw new HuggingFaceError(
        "CATALOG_UNAVAILABLE",
        "Hugging Face의 Anima 모델 목록을 불러오지 못했습니다.",
        502,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maxResponseBytes
    ) {
      throw new HuggingFaceError(
        "CATALOG_INCOMPATIBLE",
        "Hugging Face 모델 목록 응답이 허용 크기를 초과했습니다.",
        502,
      );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > this.maxResponseBytes) {
      throw new HuggingFaceError(
        "CATALOG_INCOMPATIBLE",
        "Hugging Face 모델 목록 응답이 허용 크기를 초과했습니다.",
        502,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HuggingFaceError(
        "CATALOG_INCOMPATIBLE",
        "Hugging Face 모델 목록 형식이 올바르지 않습니다.",
        502,
      );
    }
  }
}

function kindForDirectory(
  directory: string,
): Pick<HuggingFaceAnimaFileDto, "kind" | "destinationRootId"> {
  if (directory === "diffusion_models") {
    return {
      kind: "diffusion_model",
      destinationRootId: "diffusion_models",
    };
  }
  if (directory === "text_encoders") {
    return {
      kind: "text_encoder",
      destinationRootId: "text_encoders",
    };
  }
  return { kind: "vae", destinationRootId: "vae" };
}

function catalogFile(
  entry: z.infer<typeof treeEntrySchema>,
): HuggingFaceAnimaFileDto | null {
  const match = entry.path.match(supportedPath);
  if (!match) return null;
  const [, directory, filename] = match;
  assertHuggingFace(
    entry.type === "file" &&
      entry.lfs !== undefined &&
      entry.lfs.size === entry.size &&
      safeFilename.test(filename!),
    "CATALOG_INCOMPATIBLE",
    "Anima 저장소에 검증할 수 없는 모델 파일이 포함되어 있습니다.",
    502,
  );
  const mapped = kindForDirectory(directory!);
  const lower = filename!.toLowerCase();
  return {
    path: entry.path,
    filename: basename(filename!),
    ...mapped,
    sizeBytes: entry.size,
    sha256: entry.lfs.oid,
    recommended:
      mapped.kind !== "diffusion_model" ||
      lower === "anima-turbo-v1.0.safetensors" ||
      lower === "anima-base-v1.0.safetensors" ||
      lower === "anima-aesthetic-v1.1.safetensors",
    experimental: lower.includes("preview"),
    installationId: null,
    installationStatus: "not_installed",
    installationProgress: null,
  } satisfies HuggingFaceAnimaFileDto;
}

function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class HuggingFaceAnimaClient {
  constructor(private readonly transport: HuggingFaceJsonTransport) {}

  async catalog(revision?: string): Promise<HuggingFaceAnimaCatalogDto> {
    if (revision) {
      assertHuggingFace(
        /^[a-f0-9]{40}$/.test(revision),
        "INVALID_REVISION",
        "Anima 저장소 revision이 올바르지 않습니다.",
      );
    }
    const modelUrl = revision
      ? `https://huggingface.co/api/models/${HUGGING_FACE_ANIMA_REPOSITORY}/revision/${revision}`
      : `https://huggingface.co/api/models/${HUGGING_FACE_ANIMA_REPOSITORY}`;
    const modelResult = modelSchema.safeParse(
      await this.transport.json(modelUrl),
    );
    if (!modelResult.success) {
      throw new HuggingFaceError(
        "CATALOG_INCOMPATIBLE",
        "Hugging Face Anima 저장소 정보 형식이 올바르지 않습니다.",
        502,
      );
    }
    const model = modelResult.data;
    assertHuggingFace(
      model.id.toLowerCase() === HUGGING_FACE_ANIMA_REPOSITORY.toLowerCase() &&
        model.private === false &&
        (model.gated === undefined || model.gated === false) &&
        (!revision || model.sha === revision),
      "CATALOG_INCOMPATIBLE",
      "공개 Anima 저장소의 고정 revision을 확인하지 못했습니다.",
      502,
    );
    const treeResult = treeSchema.safeParse(
      await this.transport.json(
        `https://huggingface.co/api/models/${HUGGING_FACE_ANIMA_REPOSITORY}/tree/${model.sha}?recursive=true&expand=true`,
      ),
    );
    if (!treeResult.success) {
      throw new HuggingFaceError(
        "CATALOG_INCOMPATIBLE",
        "Hugging Face Anima 파일 목록 형식이 올바르지 않습니다.",
        502,
      );
    }
    const files = treeResult.data
      .map(catalogFile)
      .filter((file): file is HuggingFaceAnimaFileDto => file !== null)
      .sort((left, right) => left.path.localeCompare(right.path));
    assertHuggingFace(
      files.some((file) => file.kind === "diffusion_model") &&
        files.some(
          (file) =>
            file.path ===
            "split_files/text_encoders/qwen_3_06b_base.safetensors",
        ) &&
        files.some(
          (file) =>
            file.path === "split_files/vae/qwen_image_vae.safetensors",
        ),
      "CATALOG_INCOMPATIBLE",
      "Anima 실행에 필요한 모델, Text Encoder 또는 VAE가 없습니다.",
      502,
    );
    return {
      provider: "huggingface",
      repository: HUGGING_FACE_ANIMA_REPOSITORY,
      sourceUrl: HUGGING_FACE_ANIMA_SOURCE_URL,
      revision: model.sha,
      lastModified: model.lastModified ?? null,
      license: HUGGING_FACE_ANIMA_LICENSE,
      licenseUrl: `${HUGGING_FACE_ANIMA_SOURCE_URL}/blob/${model.sha}/LICENSE.md`,
      thumbnailUrl: `${HUGGING_FACE_ANIMA_SOURCE_URL}/resolve/${model.sha}/example.png`,
      files,
    };
  }

  downloadUrl(revision: string, path: string): string {
    assertHuggingFace(
      /^[a-f0-9]{40}$/.test(revision) && supportedPath.test(path),
      "INVALID_FILE",
      "Anima 모델 다운로드 선택이 올바르지 않습니다.",
    );
    return `${HUGGING_FACE_ANIMA_SOURCE_URL}/resolve/${revision}/${encodeRepositoryPath(path)}?download=true`;
  }
}

export function destinationKindForAnimaFile(
  file: HuggingFaceAnimaFileDto,
): Extract<
  ModelDestinationKind,
  "diffusion_models" | "text_encoders" | "vae"
> {
  return file.destinationRootId;
}
