import {
  characterProfileCreateSchema,
  characterProfileUpdateSchema,
  characterRepresentativeSchema,
  modelPackCreateSchema,
  modelPackUpdateSchema,
  type CharacterProfileDto,
  type ModelPackDto,
} from "@anima/shared";
import { StudioRepository } from "../db/repository";
import { JobSubmissionError } from "./jobs";

function validationError(label: string, error: unknown): JobSubmissionError {
  return new JobSubmissionError(`${label} is invalid.`, 422, error);
}

export class StudioLibraryService {
  constructor(private readonly repository: StudioRepository) {}

  private assertAssetsExist(assetIds: string[]): void {
    const rows = this.repository.findAssets(assetIds);
    if (rows.length === assetIds.length) return;
    const found = new Set(rows.map((row) => row.id));
    throw new JobSubmissionError(
      "One or more reference assets do not exist.",
      422,
      {
        missingAssetIds: assetIds.filter((id) => !found.has(id)),
      },
    );
  }

  listCharacterProfiles(): CharacterProfileDto[] {
    return this.repository.listCharacterProfiles();
  }

  getCharacterProfile(id: string): CharacterProfileDto {
    const profile = this.repository.findCharacterProfile(id);
    if (!profile) throw new JobSubmissionError("Character profile not found.", 404);
    return profile;
  }

  createCharacterProfile(raw: unknown): CharacterProfileDto {
    const parsed = characterProfileCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError(
        "Character profile",
        parsed.error.flatten(),
      );
    }
    this.assertAssetsExist(parsed.data.referenceAssetIds);
    return this.repository.createCharacterProfile(parsed.data);
  }

  updateCharacterProfile(
    id: string,
    raw: unknown,
  ): CharacterProfileDto {
    this.getCharacterProfile(id);
    const parsed = characterProfileUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError(
        "Character profile update",
        parsed.error.flatten(),
      );
    }
    if (parsed.data.referenceAssetIds) {
      this.assertAssetsExist(parsed.data.referenceAssetIds);
    }
    return this.repository.updateCharacterProfile(id, parsed.data)!;
  }

  setRepresentative(id: string, raw: unknown): CharacterProfileDto {
    this.getCharacterProfile(id);
    const parsed = characterRepresentativeSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError(
        "Representative image selection",
        parsed.error.flatten(),
      );
    }
    if (parsed.data.outputId && !this.repository.findOutput(parsed.data.outputId)) {
      throw new JobSubmissionError("Output not found.", 404);
    }
    return this.repository.setCharacterRepresentative(
      id,
      parsed.data.outputId,
    )!;
  }

  deleteCharacterProfile(id: string): void {
    if (!this.repository.deleteCharacterProfile(id)) {
      throw new JobSubmissionError("Character profile not found.", 404);
    }
  }

  listModelPacks(): ModelPackDto[] {
    return this.repository.listModelPacks();
  }

  getModelPack(id: string): ModelPackDto {
    const pack = this.repository.findModelPack(id);
    if (!pack) throw new JobSubmissionError("Model pack not found.", 404);
    return pack;
  }

  createModelPack(raw: unknown): ModelPackDto {
    const parsed = modelPackCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError("Model pack", parsed.error.flatten());
    }
    return this.repository.createModelPack(parsed.data);
  }

  updateModelPack(id: string, raw: unknown): ModelPackDto {
    this.getModelPack(id);
    const parsed = modelPackUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError("Model pack update", parsed.error.flatten());
    }
    return this.repository.updateModelPack(id, parsed.data)!;
  }

  deleteModelPack(id: string): void {
    if (!this.repository.deleteModelPack(id)) {
      throw new JobSubmissionError("Model pack not found.", 404);
    }
  }
}
