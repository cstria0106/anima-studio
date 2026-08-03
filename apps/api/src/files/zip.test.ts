import { describe, expect, test } from "bun:test";
import { createZipStream, uniqueZipNames } from "./zip";

describe("ZIP output", () => {
  test("keeps duplicate filenames distinct", () => {
    expect(uniqueZipNames(["image.png", "image.png", "folder/image.png"])).toEqual([
      "image.png",
      "image (2).png",
      "image (3).png",
    ]);
  });

  test("streams local, central, and end records", async () => {
    const response = new Response(
      createZipStream(
        [{ name: "이미지.png", load: async () => new Uint8Array([1, 2, 3]) }],
        new Date(2026, 0, 2, 3, 4, 6),
      ),
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.byteLength - 22, true)).toBe(0x06054b50);
    expect(new TextDecoder().decode(bytes)).toContain("이미지.png");
  });
});
