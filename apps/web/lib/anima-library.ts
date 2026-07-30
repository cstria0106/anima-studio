import type {
  HuggingFaceAnimaFile,
  ModelDownload,
  ModelDownloadState,
} from "@/lib/types";

const activeDownloadStates = new Set<ModelDownloadState>([
  "resolving",
  "queued",
  "downloading",
  "paused",
  "verifying",
  "indexing",
]);

const terminalDownloadStates = new Set<ModelDownloadState>([
  "completed",
  "failed",
  "cancelled",
]);

function matchesCatalogFile(
  download: ModelDownload,
  revision: string,
  file: HuggingFaceAnimaFile,
) {
  return (
    download.provider === "huggingface" &&
    download.providerFileId === file.path &&
    (download.expectedSha256 === file.sha256 ||
      download.actualSha256 === file.sha256 ||
      download.providerVersionId === revision)
  );
}

/**
 * Resolve the row that best represents a catalog file.
 *
 * The repository revision may move without changing a file's LFS object.
 * Matching a verified SHA keeps an already installed file installed while an
 * active row for the current artifact still takes precedence in the UI.
 */
export function findAnimaFileDownload(
  downloads: readonly ModelDownload[],
  revision: string,
  file: HuggingFaceAnimaFile,
): ModelDownload | undefined {
  const activeForPath = downloads.find(
    (download) =>
      download.provider === "huggingface" &&
      download.providerFileId === file.path &&
      activeDownloadStates.has(download.state),
  );
  if (activeForPath) return activeForPath;

  const candidates = downloads.filter((download) =>
    matchesCatalogFile(download, revision, file),
  );
  return (
    candidates.find(
      (download) =>
        download.state === "completed" &&
        (download.actualSha256 === file.sha256 ||
          download.expectedSha256 === file.sha256),
    ) ??
    candidates.find((download) => download.providerVersionId === revision)
  );
}

/**
 * Catalog/provider data only needs refreshing when an existing Hugging Face
 * task crosses into a terminal state. Initial history hydration and Civitai
 * transitions must not cause additional remote catalog requests.
 */
export function hasNewlySettledAnimaDownload(
  previous: readonly ModelDownload[],
  next: readonly ModelDownload[],
): boolean {
  const previousStates = new Map(
    previous
      .filter((download) => download.provider === "huggingface")
      .map((download) => [download.id, download.state]),
  );
  return next.some((download) => {
    if (
      download.provider !== "huggingface" ||
      !terminalDownloadStates.has(download.state)
    ) {
      return false;
    }
    const previousState = previousStates.get(download.id);
    return (
      previousState !== undefined &&
      !terminalDownloadStates.has(previousState)
    );
  });
}

/**
 * External mode already has one managed-runtime remedy in the Anima panel.
 * Keep the Civitai-specific remedy only when its provider alone is unavailable
 * (or the Anima provider could not be loaded).
 */
export function shouldShowSeparateCivitaiRemedy(
  civitaiManagedDownloads: boolean | null | undefined,
  animaManagedDownloads: boolean | null | undefined,
): boolean {
  return (
    civitaiManagedDownloads === false &&
    animaManagedDownloads !== false
  );
}
