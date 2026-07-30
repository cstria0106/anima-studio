import { describe, expect, test } from "bun:test";

import {
  findAnimaFileDownload,
  hasNewlySettledAnimaDownload,
  shouldShowSeparateCivitaiRemedy,
} from "./anima-library";
import type {
  HuggingFaceAnimaFile,
  ModelDownload,
  ModelDownloadState,
} from "./types";

const file: HuggingFaceAnimaFile = {
  path: "split_files/diffusion_models/anima-base-v1.0.safetensors",
  filename: "anima-base-v1.0.safetensors",
  kind: "diffusion_model",
  destinationRootId: "diffusion_models",
  sizeBytes: 4_182_218_328,
  sha256: "a".repeat(64),
  recommended: true,
  experimental: false,
};

function download(
  id: string,
  state: ModelDownloadState,
  overrides: Partial<ModelDownload> = {},
): ModelDownload {
  return {
    id,
    operationId: `operation-${id}`,
    state,
    provider: "huggingface",
    providerModelId: "circlestone-labs/Anima",
    providerVersionId: "1".repeat(40),
    providerFileId: file.path,
    modelId: null,
    modelVersionId: null,
    fileId: null,
    modelName: "CircleStone Labs Anima",
    versionName: "111111111111",
    filename: file.filename,
    destinationRootId: "diffusion_models",
    relativeDir: "",
    expectedSha256: file.sha256,
    actualSha256: state === "completed" ? file.sha256 : null,
    bytesCompleted: state === "completed" ? file.sizeBytes : 0,
    bytesTotal: file.sizeBytes,
    bytesPerSecond: null,
    triggerWords: [],
    metadata: {},
    error: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    completedAt:
      state === "completed" ? "2026-07-30T00:00:00.000Z" : null,
    ...overrides,
  };
}

describe("Anima Library download state", () => {
  test("keeps a verified file installed when only the repository revision changes", () => {
    const completed = download("completed", "completed");

    expect(
      findAnimaFileDownload(
        [completed],
        "2".repeat(40),
        file,
      )?.state,
    ).toBe("completed");
  });

  test("does not reuse a completed row when the catalog file hash changed", () => {
    const completed = download("completed", "completed");

    expect(
      findAnimaFileDownload([completed], "2".repeat(40), {
        ...file,
        sha256: "b".repeat(64),
      }),
    ).toBeUndefined();
  });

  test("shows an active current artifact ahead of an older completed row", () => {
    const completed = download("completed", "completed");
    const active = download("active", "downloading", {
      providerVersionId: "2".repeat(40),
    });

    expect(
      findAnimaFileDownload(
        [completed, active],
        "2".repeat(40),
        file,
      )?.id,
    ).toBe("active");
  });

  test("keeps the destination blocked while an older revision is still active", () => {
    const active = download("active", "downloading", {
      providerVersionId: "1".repeat(40),
      expectedSha256: "b".repeat(64),
    });

    expect(
      findAnimaFileDownload(
        [active],
        "2".repeat(40),
        file,
      )?.state,
    ).toBe("downloading");
  });

  test("detects an existing Hugging Face task entering a terminal state", () => {
    expect(
      hasNewlySettledAnimaDownload(
        [download("model", "verifying")],
        [download("model", "completed")],
      ),
    ).toBeTrue();
  });

  test("ignores completed history during initial hydration", () => {
    expect(
      hasNewlySettledAnimaDownload([], [
        download("model", "completed"),
      ]),
    ).toBeFalse();
  });

  test("ignores Civitai task transitions", () => {
    const current = download("model", "downloading", {
      provider: "civitai",
      modelId: 1,
      modelVersionId: 2,
      fileId: 3,
    });
    const completed = {
      ...current,
      state: "completed" as const,
      completedAt: "2026-07-30T00:00:00.000Z",
    };

    expect(
      hasNewlySettledAnimaDownload([current], [completed]),
    ).toBeFalse();
  });

  test("uses one managed-runtime remedy when both providers are external", () => {
    expect(shouldShowSeparateCivitaiRemedy(false, false)).toBeFalse();
  });

  test("keeps the Civitai remedy for a provider-specific outage", () => {
    expect(shouldShowSeparateCivitaiRemedy(false, true)).toBeTrue();
  });
});
