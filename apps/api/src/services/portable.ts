import { createHash } from "node:crypto";
import {
  PORTABLE_BUNDLE_FORMAT,
  PORTABLE_BUNDLE_VERSION,
  PORTABLE_MAX_ASSET_BYTES,
  PORTABLE_MAX_ASSETS,
  PORTABLE_MAX_TOTAL_ASSET_BYTES,
  portableBundleSchema,
  portableExportRequestSchema,
  portableImportRequestSchema,
  type ComfyOptions,
  type PortableAsset,
  type PortableBundle,
  type PortableImportIssue,
  type PortableImportPreviewDto,
  type PortableImportResultDto,
} from "@anima/shared";
import { StudioRepository } from "../db/repository";
import { inspectImage } from "../files/image-metadata";
import {
  FileStorage,
  FileValidationError,
} from "../files/storage";
import { CapabilityService } from "./capabilities";
import { JobSubmissionError } from "./jobs";
import { StudioLibraryService } from "./studio-library";

function decodePortableAsset(asset: PortableAsset): Uint8Array {
  if (
    asset.dataBase64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      asset.dataBase64,
    )
  ) {
    throw new JobSubmissionError(
      `Portable asset ${asset.name} is not canonical base64.`,
      422,
    );
  }
  const bytes = Uint8Array.from(Buffer.from(asset.dataBase64, "base64"));
  if (bytes.byteLength !== asset.byteSize) {
    throw new JobSubmissionError(
      `Portable asset ${asset.name} does not match its declared size.`,
      422,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) {
    throw new JobSubmissionError(
      `Portable asset ${asset.name} failed SHA-256 verification.`,
      422,
    );
  }
  return bytes;
}

function normalizedModelName(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function installed(
  selected: string,
  candidates: readonly string[],
): boolean {
  const target = normalizedModelName(selected);
  return candidates.some((candidate) => normalizedModelName(candidate) === target);
}

export class PortableWorkspaceService {
  constructor(
    private readonly repository: StudioRepository,
    private readonly storage: FileStorage,
    private readonly library: StudioLibraryService,
    private readonly capabilities: CapabilityService,
  ) {}

  private parseBundle(raw: unknown): {
    bundle: PortableBundle;
    decoded: Map<string, Uint8Array>;
    totalAssetBytes: number;
  } {
    const parsed = portableBundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JobSubmissionError(
        "Portable bundle is invalid.",
        422,
        parsed.error.flatten(),
      );
    }
    const bundle = parsed.data;
    const hashes = bundle.assets.map((asset) => asset.sha256);
    if (new Set(hashes).size !== hashes.length) {
      throw new JobSubmissionError(
        "Portable assets may only be included once per SHA-256.",
        422,
      );
    }
    const decoded = new Map<string, Uint8Array>();
    let totalAssetBytes = 0;
    for (const asset of bundle.assets) {
      const bytes = decodePortableAsset(asset);
      const metadata = inspectImage(bytes);
      if (
        !metadata ||
        metadata.mimeType !== asset.mimeType ||
        (asset.width !== null && metadata.width !== asset.width) ||
        (asset.height !== null && metadata.height !== asset.height)
      ) {
        throw new JobSubmissionError(
          `Portable asset ${asset.name} does not match its declared image metadata.`,
          422,
        );
      }
      totalAssetBytes += bytes.byteLength;
      if (totalAssetBytes > PORTABLE_MAX_TOTAL_ASSET_BYTES) {
        throw new JobSubmissionError(
          `Portable assets exceed the ${PORTABLE_MAX_TOTAL_ASSET_BYTES} byte total limit.`,
          413,
        );
      }
      decoded.set(asset.sha256, bytes);
    }
    const availableHashes = new Set([
      ...hashes,
      ...this.repository.listAssetRows().map((asset) => asset.sha256),
    ]);
    const missingReferences = [
      ...new Set(
        bundle.characterProfiles.flatMap((profile) =>
          profile.referenceAssetSha256.filter(
            (sha256) => !availableHashes.has(sha256),
          ),
        ),
      ),
    ];
    if (missingReferences.length > 0) {
      throw new JobSubmissionError(
        "Portable character profiles reference images that are not embedded or already stored.",
        422,
        { missingAssetSha256: missingReferences },
      );
    }
    return { bundle, decoded, totalAssetBytes };
  }

  private async validateAssets(
    bundle: PortableBundle,
    decoded: Map<string, Uint8Array>,
  ): Promise<void> {
    for (const asset of bundle.assets) {
      const bytes = decoded.get(asset.sha256)!;
      const fileBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(fileBuffer).set(bytes);
      try {
        await this.storage.validateAsset(
          new File([fileBuffer], asset.name, { type: asset.mimeType }),
        );
      } catch (error) {
        if (error instanceof FileValidationError) {
          throw new JobSubmissionError(
            `Portable asset ${asset.name} cannot be imported: ${error.message}`,
            error.status,
            { sha256: asset.sha256 },
          );
        }
        throw error;
      }
    }
  }

  async export(raw: unknown): Promise<PortableBundle> {
    const parsed = portableExportRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JobSubmissionError(
        "Portable export selection is invalid.",
        422,
        parsed.error.flatten(),
      );
    }
    const profiles = parsed.data.characterProfileIds.map((id) =>
      this.library.getCharacterProfile(id),
    );
    const packs = parsed.data.modelPackIds.map((id) =>
      this.library.getModelPack(id),
    );
    const assetIds = [
      ...new Set(profiles.flatMap((profile) => profile.referenceAssetIds)),
    ];
    const assetRowsById = new Map(
      assetIds.map((assetId) => {
        const row = this.repository.findAsset(assetId);
        if (!row) {
          throw new JobSubmissionError(
            "A selected character profile contains a missing reference image.",
            409,
            { assetId },
          );
        }
        return [assetId, row] as const;
      }),
    );
    const uniqueRowsByHash = new Map(
      [...assetRowsById.values()].map((row) => [row.sha256, row]),
    );
    if (uniqueRowsByHash.size > PORTABLE_MAX_ASSETS) {
      throw new JobSubmissionError(
        `Portable exports may contain at most ${PORTABLE_MAX_ASSETS} images.`,
        413,
      );
    }
    const portableAssets: PortableAsset[] = [];
    let totalBytes = 0;
    for (const row of uniqueRowsByHash.values()) {
      const file = await this.storage.readAsset(row);
      if (file.bytes.byteLength > PORTABLE_MAX_ASSET_BYTES) {
        throw new JobSubmissionError(
          `Portable asset ${row.originalName} exceeds the ${PORTABLE_MAX_ASSET_BYTES} byte per-image limit.`,
          413,
          { assetId: row.id },
        );
      }
      const digest = createHash("sha256").update(file.bytes).digest("hex");
      if (digest !== row.sha256) {
        throw new JobSubmissionError(
          "A stored reference image failed SHA-256 verification.",
          409,
          { assetId: row.id },
        );
      }
      totalBytes += file.bytes.byteLength;
      if (totalBytes > PORTABLE_MAX_TOTAL_ASSET_BYTES) {
        throw new JobSubmissionError(
          `Portable assets exceed the ${PORTABLE_MAX_TOTAL_ASSET_BYTES} byte total limit.`,
          413,
        );
      }
      portableAssets.push({
        sha256: row.sha256,
        name: row.originalName,
        mimeType: row.mimeType as PortableAsset["mimeType"],
        byteSize: file.bytes.byteLength,
        width: row.width,
        height: row.height,
        dataBase64: Buffer.from(file.bytes).toString("base64"),
      });
    }
    return portableBundleSchema.parse({
      format: PORTABLE_BUNDLE_FORMAT,
      version: PORTABLE_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      assets: portableAssets,
      characterProfiles: profiles.map((profile) => ({
        sourceId: profile.id,
        name: profile.name,
        description: profile.description,
        referenceAssetSha256: profile.referenceAssets.map(
          (asset) => assetRowsById.get(asset.id)!.sha256,
        ),
        prompts: profile.prompts,
        instantLora: profile.instantLora,
        excludedTags: profile.excludedTags,
        cache: profile.cache,
      })),
      modelPacks: packs.map((pack) => ({
        sourceId: pack.id,
        name: pack.name,
        description: pack.description,
        model: pack.model,
        loras: pack.loras,
      })),
    });
  }

  async preview(raw: unknown): Promise<PortableImportPreviewDto> {
    const request = portableImportRequestSchema.safeParse(raw);
    if (!request.success) {
      throw new JobSubmissionError(
        "Portable import request is invalid.",
        422,
        request.error.flatten(),
      );
    }
    const {
      bundle,
      decoded,
      totalAssetBytes,
    } = this.parseBundle(request.data.bundle);
    await this.validateAssets(bundle, decoded);
    const missing = new Map<string, PortableImportIssue>();
    const report = await this.capabilities.report();
    for (const issue of report.missing) {
      const mapped: PortableImportIssue = {
        kind: issue.kind,
        id: issue.id,
        label: issue.label,
      };
      if (issue.package) mapped.package = issue.package;
      if (issue.installUrl) mapped.installUrl = issue.installUrl;
      missing.set(`${mapped.kind}:${mapped.id}`, mapped);
    }

    let options: ComfyOptions | null = null;
    try {
      options = await this.capabilities.options();
    } catch {
      // The endpoint issue from the capability report explains why model
      // availability cannot currently be verified.
    }
    for (const pack of bundle.modelPacks) {
      const selections: Array<{
        selected: string;
        candidates: readonly string[];
        label: string;
      }> = [
        {
          selected: pack.model.diffusionModel,
          candidates: options?.diffusionModels ?? [],
          label: "Diffusion model",
        },
        {
          selected: pack.model.clip,
          candidates: options?.clips ?? [],
          label: "CLIP model",
        },
        {
          selected: pack.model.vae,
          candidates: options?.vaes ?? [],
          label: "VAE",
        },
        ...pack.loras
          .filter((lora) => lora.enabled)
          .map((lora) => ({
            selected: lora.name,
            candidates: options?.loras ?? [],
            label: "LoRA",
          })),
      ];
      for (const selection of selections) {
        if (installed(selection.selected, selection.candidates)) continue;
        const issue: PortableImportIssue = {
          kind: "model",
          id: selection.selected,
          label: `${selection.label} is not installed: ${selection.selected}`,
        };
        missing.set(`model:${normalizedModelName(selection.selected)}`, issue);
      }
    }

    const existingCount = bundle.assets.filter((asset) =>
      this.repository.findAssetByHash(asset.sha256),
    ).length;
    return {
      valid: true,
      assetCount: bundle.assets.length,
      newAssetCount: bundle.assets.length - existingCount,
      deduplicatedAssetCount: existingCount,
      totalAssetBytes,
      characterProfileCount: bundle.characterProfiles.length,
      modelPackCount: bundle.modelPacks.length,
      missing: [...missing.values()],
    };
  }

  async import(raw: unknown): Promise<PortableImportResultDto> {
    const request = portableImportRequestSchema.safeParse(raw);
    if (!request.success) {
      throw new JobSubmissionError(
        "Portable import request is invalid.",
        422,
        request.error.flatten(),
      );
    }
    const { bundle, decoded } = this.parseBundle(request.data.bundle);
    const preview = await this.preview(request.data);
    const assetIdsByHash = new Map<string, string>();
    for (const asset of bundle.assets) {
      const existing = this.repository.findAssetByHash(asset.sha256);
      if (existing) {
        assetIdsByHash.set(asset.sha256, existing.id);
        continue;
      }
      const bytes = decoded.get(asset.sha256)!;
      const fileBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(fileBuffer).set(bytes);
      const stored = await this.storage.storeAsset(
        new File([fileBuffer], asset.name, { type: asset.mimeType }),
      );
      const row = this.repository.findAsset(stored.id);
      if (!row || row.sha256 !== asset.sha256) {
        throw new JobSubmissionError(
          "An imported asset did not preserve its verified SHA-256.",
          500,
        );
      }
      assetIdsByHash.set(asset.sha256, stored.id);
    }
    for (const row of this.repository.listAssetRows()) {
      if (!assetIdsByHash.has(row.sha256)) {
        assetIdsByHash.set(row.sha256, row.id);
      }
    }

    const characterProfiles = bundle.characterProfiles.map((profile) =>
      this.library.createCharacterProfile({
        name: profile.name,
        description: profile.description,
        referenceAssetIds: profile.referenceAssetSha256.map(
          (sha256) => assetIdsByHash.get(sha256)!,
        ),
        prompts: profile.prompts,
        instantLora: profile.instantLora,
        excludedTags: profile.excludedTags,
        cache: {
          ...profile.cache,
          state: profile.cache.state === "ready" ? "stale" : profile.cache.state,
        },
      }),
    );
    const modelPacks = bundle.modelPacks.map((pack) =>
      this.library.createModelPack({
        name: pack.name,
        description: pack.description,
        model: pack.model,
        loras: pack.loras,
      }),
    );
    return { preview, characterProfiles, modelPacks };
  }
}
