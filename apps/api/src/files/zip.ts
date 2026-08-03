export interface ZipEntry {
  name: string;
  load: () => Promise<Uint8Array>;
}

interface CentralEntry {
  name: Uint8Array;
  checksum: number;
  size: number;
  offset: number;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  };
}

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

export function uniqueZipNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((original, index) => {
    const safe = original.split(/[\\/]/).at(-1)?.trim() || `image-${index + 1}`;
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : "";
    let candidate = safe;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${stem} (${suffix})${extension}`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

export function createZipStream(
  entries: ZipEntry[],
  modifiedAt = new Date(),
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        const central: CentralEntry[] = [];
        const { date, time } = zipDateTime(modifiedAt);
        let offset = 0;

        for (const entry of entries) {
          const name = encoder.encode(entry.name.replaceAll("\\", "/"));
          const bytes = await entry.load();
          const checksum = crc32(bytes);
          const local = header(30, (view) => {
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 0x0800, true);
            view.setUint16(10, time, true);
            view.setUint16(12, date, true);
            view.setUint32(14, checksum, true);
            view.setUint32(18, bytes.byteLength, true);
            view.setUint32(22, bytes.byteLength, true);
            view.setUint16(26, name.byteLength, true);
          });
          controller.enqueue(local);
          controller.enqueue(name);
          controller.enqueue(bytes);
          central.push({ name, checksum, size: bytes.byteLength, offset });
          offset += local.byteLength + name.byteLength + bytes.byteLength;
        }

        const centralOffset = offset;
        for (const entry of central) {
          const record = header(46, (view) => {
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint16(8, 0x0800, true);
            view.setUint16(12, time, true);
            view.setUint16(14, date, true);
            view.setUint32(16, entry.checksum, true);
            view.setUint32(20, entry.size, true);
            view.setUint32(24, entry.size, true);
            view.setUint16(28, entry.name.byteLength, true);
            view.setUint32(42, entry.offset, true);
          });
          controller.enqueue(record);
          controller.enqueue(entry.name);
          offset += record.byteLength + entry.name.byteLength;
        }

        controller.enqueue(
          header(22, (view) => {
            view.setUint32(0, 0x06054b50, true);
            view.setUint16(8, central.length, true);
            view.setUint16(10, central.length, true);
            view.setUint32(12, offset - centralOffset, true);
            view.setUint32(16, centralOffset, true);
          }),
        );
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
