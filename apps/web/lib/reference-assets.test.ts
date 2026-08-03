import { describe, expect, test } from "bun:test";
import type { ReferenceAsset } from "./types";
import { normalizeReferenceAssets } from "./reference-assets";

function asset(
  id: string,
  sha256?: string,
  status: ReferenceAsset["status"] = "ready",
): ReferenceAsset {
  return {
    id,
    name: `${id}.png`,
    url: `/api/assets/${id}`,
    size: 1,
    status,
    ...(sha256 ? { sha256 } : {}),
  };
}

describe("normalizeReferenceAssets", () => {
  test("keeps a content-addressed reference only once", () => {
    const duplicate = asset("shared-id", "abc");

    expect(normalizeReferenceAssets([duplicate, { ...duplicate }])).toEqual([
      duplicate,
    ]);
  });

  test("retains distinct optimistic uploads until their asset IDs resolve", () => {
    const first = asset("upload-1", undefined, "uploading");
    const second = asset("upload-2", undefined, "uploading");

    expect(normalizeReferenceAssets([first, second])).toHaveLength(2);
  });

  test("sorts resolved references by content hash", () => {
    const high = asset("first-uploaded", "zzz");
    const low = asset("second-uploaded", "aaa");

    expect(normalizeReferenceAssets([high, low]).map(({ id }) => id)).toEqual([
      low.id,
      high.id,
    ]);
  });
});
