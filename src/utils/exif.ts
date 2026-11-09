const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

function isWithinView(view: DataView, offset: number, length: number, end = view.byteLength): boolean {
  return offset >= 0 && length >= 0 && offset + length <= end && end <= view.byteLength;
}

function readIfdEntry(
  view: DataView,
  tiffOffset: number,
  ifdOffset: number,
  wantedTag: number,
  littleEndian: boolean,
  segmentEnd: number
): { type: number; count: number; valueOffset: number; entryOffset: number } | undefined {
  const absoluteIfdOffset = tiffOffset + ifdOffset;
  if (!isWithinView(view, absoluteIfdOffset, 2, segmentEnd)) return undefined;
  const entryCount = view.getUint16(absoluteIfdOffset, littleEndian);
  const entriesOffset = absoluteIfdOffset + 2;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesOffset + index * 12;
    if (!isWithinView(view, entryOffset, 12, segmentEnd)) return undefined;
    if (view.getUint16(entryOffset, littleEndian) !== wantedTag) continue;
    return {
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      valueOffset: view.getUint32(entryOffset + 8, littleEndian),
      entryOffset
    };
  }
  return undefined;
}

function readAsciiValue(
  view: DataView,
  tiffOffset: number,
  entry: { type: number; count: number; valueOffset: number; entryOffset: number },
  segmentEnd: number
): string | undefined {
  if (entry.type !== 2 || entry.count < 19 || entry.count > 64) return undefined;
  const valueOffset = entry.count <= 4
    ? entry.entryOffset + 8
    : tiffOffset + entry.valueOffset;
  if (!isWithinView(view, valueOffset, entry.count, segmentEnd)) return undefined;
  let value = "";
  for (let index = 0; index < entry.count; index += 1) {
    const code = view.getUint8(valueOffset + index);
    if (code === 0) break;
    value += String.fromCharCode(code);
  }
  return value;
}

function parseExifDateTime(view: DataView, app1Offset: number, segmentEnd: number): string | undefined {
  const tiffOffset = app1Offset + EXIF_HEADER.length;
  if (!isWithinView(view, tiffOffset, 8, segmentEnd)) return undefined;
  const byteOrder = String.fromCharCode(view.getUint8(tiffOffset), view.getUint8(tiffOffset + 1));
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return undefined;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return undefined;

  const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
  const exifPointer = readIfdEntry(
    view,
    tiffOffset,
    firstIfdOffset,
    0x8769,
    littleEndian,
    segmentEnd
  );
  if (!exifPointer || exifPointer.type !== 4 || exifPointer.count !== 1) return undefined;
  const dateEntry = readIfdEntry(
    view,
    tiffOffset,
    exifPointer.valueOffset,
    0x9003,
    littleEndian,
    segmentEnd
  );
  if (!dateEntry) return undefined;
  const value = readAsciiValue(view, tiffOffset, dateEntry, segmentEnd);
  if (!value) return undefined;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function readJpegDateTimeOriginal(file: Blob): Promise<string | undefined> {
  if (file.size < 4) return undefined;
  const view = new DataView(await file.slice(0, 65540).arrayBuffer());
  if (view.getUint16(0, false) !== 0xffd8) return undefined;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return undefined;
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= view.byteLength) return undefined;
    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (!isWithinView(view, offset, 2)) return undefined;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || !isWithinView(view, offset, segmentLength)) return undefined;
    const payloadOffset = offset + 2;
    if (
      marker === 0xe1 &&
      isWithinView(view, payloadOffset, EXIF_HEADER.length) &&
      EXIF_HEADER.every((byte, index) => view.getUint8(payloadOffset + index) === byte)
    ) {
      return parseExifDateTime(view, payloadOffset, offset + segmentLength);
    }
    offset += segmentLength;
  }
  return undefined;
}
