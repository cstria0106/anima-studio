import type { GenerationDraft, ReferenceAsset } from "@/lib/types";

/**
 * Ready reference images the next generation uses. Turning references off
 * keeps the images in the draft but generates without them.
 */
export function activeReferenceAssets(
  draft: Pick<GenerationDraft, "referenceAssets" | "referencesEnabled">,
): ReferenceAsset[] {
  return draft.referencesEnabled
    ? draft.referenceAssets.filter((asset) => asset.status === "ready")
    : [];
}

export function normalizeReferenceAssets(
  values: readonly ReferenceAsset[],
): ReferenceAsset[] {
  const unique = new Map<string, ReferenceAsset>();
  for (const asset of values) {
    if (!unique.has(asset.id)) unique.set(asset.id, asset);
  }

  return [...unique.values()].sort((left, right) => {
    const leftHash = left.sha256;
    const rightHash = right.sha256;
    if (leftHash && rightHash) return leftHash.localeCompare(rightHash);
    if (leftHash) return -1;
    if (rightHash) return 1;
    return left.id.localeCompare(right.id);
  });
}
