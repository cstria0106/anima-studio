import type { ModelDownloadDto } from "@anima/shared";

import type { CivitaiModelLibraryService } from "../civitai";
import { CivitaiError } from "../civitai";
import type { StudioRepository } from "../db/repository";
import type { HuggingFaceAnimaLibraryService } from "../huggingface";

type CivitaiDownloads = Pick<
  CivitaiModelLibraryService,
  "pause" | "resume" | "cancel" | "retry" | "settled"
>;

type HuggingFaceDownloads = Pick<
  HuggingFaceAnimaLibraryService,
  "pause" | "resume" | "cancel" | "retry" | "settled"
>;

export class ModelDownloadCoordinator {
  constructor(
    private readonly repository: StudioRepository,
    private readonly civitai: CivitaiDownloads,
    private readonly huggingFace: HuggingFaceDownloads,
  ) {}

  get(id: string): ModelDownloadDto {
    const download = this.repository.findModelDownload(id);
    if (!download) {
      throw new CivitaiError(
        "DOWNLOAD_NOT_FOUND",
        "The model download was not found.",
        404,
      );
    }
    return download;
  }

  list(limit = 50): ModelDownloadDto[] {
    return this.repository.listModelDownloads(limit);
  }

  pause(id: string): Promise<ModelDownloadDto> {
    return this.serviceFor(id).pause(id);
  }

  resume(id: string): Promise<ModelDownloadDto> {
    return Promise.resolve(this.serviceFor(id).resume(id));
  }

  cancel(id: string): Promise<ModelDownloadDto> {
    return this.serviceFor(id).cancel(id);
  }

  retry(id: string): Promise<ModelDownloadDto> {
    return this.serviceFor(id).retry(id);
  }

  settled(id: string): Promise<ModelDownloadDto> {
    return this.serviceFor(id).settled(id);
  }

  private serviceFor(id: string): CivitaiDownloads | HuggingFaceDownloads {
    return this.get(id).provider === "huggingface"
      ? this.huggingFace
      : this.civitai;
  }
}
