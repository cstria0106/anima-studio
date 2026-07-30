export interface ImageMetadata {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  width: number | null;
  height: number | null;
}

function is(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function png(bytes: Uint8Array): ImageMetadata | null {
  if (!is(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return null;
  }
  if (bytes.length < 24) {
    return { mimeType: "image/png", extension: "png", width: null, height: null };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    mimeType: "image/png",
    extension: "png",
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function jpeg(bytes: Uint8Array): ImageMetadata | null {
  if (!is(bytes, [0xff, 0xd8, 0xff])) return null;
  let offset = 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    if (offset + 4 > bytes.length) break;
    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        mimeType: "image/jpeg",
        extension: "jpg",
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }
    offset += segmentLength + 2;
  }
  return { mimeType: "image/jpeg", extension: "jpg", width: null, height: null };
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function webp(bytes: Uint8Array): ImageMetadata | null {
  if (
    !is(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    !is(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return null;
  }
  if (bytes.length < 30) {
    return {
      mimeType: "image/webp",
      extension: "webp",
      width: null,
      height: null,
    };
  }
  const chunk = new TextDecoder("ascii").decode(bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      mimeType: "image/webp",
      extension: "webp",
      width: 1 + readUint24LE(bytes, 24),
      height: 1 + readUint24LE(bytes, 27),
    };
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      mimeType: "image/webp",
      extension: "webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21]!;
    const b2 = bytes[22]!;
    const b3 = bytes[23]!;
    const b4 = bytes[24]!;
    return {
      mimeType: "image/webp",
      extension: "webp",
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
    };
  }
  return {
    mimeType: "image/webp",
    extension: "webp",
    width: null,
    height: null,
  };
}

export function inspectImage(bytes: Uint8Array): ImageMetadata | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}
