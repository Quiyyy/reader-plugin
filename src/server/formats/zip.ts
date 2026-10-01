import { Inflate } from 'fflate';

/** Hard bounds checked against ZIP metadata before any book data is inflated. */
export const ZIP_LIMITS = Object.freeze({
  compressedBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 16 * 1024 * 1024,
  entries: 2_000,
  compressionRatio: 200,
});

interface Entry { name: string; size: number; compressedSize: number; offset: number; method: number; crc: number; }
const fail = (message: string): never => { throw new Error(`Unsafe or unsupported EPUB archive: ${message}`); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeArchivePath(name: string): string {
  if (!name || name.length > 1_024 || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) fail('invalid entry path');
  const parts = name.split('/');
  if (parts.some(part => part === '..' || part === '.')) fail('path traversal is not allowed');
  if (parts.slice(0, -1).some(part => !part)) fail('ambiguous entry path');
  return name;
}

/** Validate central and local headers, then inflate with bounded streaming output. Never extract to disk. */
export function readSafeZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > ZIP_LIMITS.compressedBytes) fail('file exceeds the 32 MiB upload limit');
  if (bytes.length < 22) fail('missing ZIP directory');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('missing or malformed ZIP directory');
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), centralOffset = u32(eocd + 16);
  if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== count) fail('multi-disk archives are unsupported');
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64 is unsupported');
  if (!count || count > ZIP_LIMITS.entries) fail('archive must have between 1 and 2,000 entries');
  if (centralOffset + centralSize !== eocd) fail('invalid central directory bounds');
  const entries: Entry[] = [], names = new Set<string>(), ranges: [number, number][] = [];
  let cursor = centralOffset, expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || u32(cursor) !== 0x02014b50) fail('invalid central directory entry');
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressedSize = u32(cursor + 20), size = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const localOffset = u32(cursor + 42), end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || !nameLength) fail('invalid entry bounds');
    if (flags & (1 | 64) || u16(cursor + 34)) fail('encrypted ZIP entries and multiple disks are unsupported');
    if (method !== 0 && method !== 8) fail('only stored and DEFLATE entries are supported');
    if ([compressedSize, size, localOffset].includes(0xffffffff)) fail('ZIP64 entries are unsupported');
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { fail('entry names must be UTF-8'); }
    safeArchivePath(name!);
    if (names.has(name!)) fail('duplicate entry paths are not allowed');
    names.add(name!);
    // Reject symbolic links even though this reader never writes archive paths to disk.
    const unixMode = u32(cursor + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) fail('symbolic links are not supported');
    if (size > ZIP_LIMITS.entryBytes) fail('entry exceeds the 16 MiB expanded limit');
    expandedTotal += size;
    if (expandedTotal > ZIP_LIMITS.expandedBytes) fail('archive exceeds the 64 MiB expanded limit');
    if (size > Math.max(1, compressedSize) * ZIP_LIMITS.compressionRatio) fail('compression ratio exceeds 200:1');
    if (method === 0 && size !== compressedSize) fail('invalid stored entry size');
    if (localOffset + 30 > centralOffset || u32(localOffset) !== 0x04034b50) fail('invalid local header');
    const localFlags = u16(localOffset + 6), localMethod = u16(localOffset + 8);
    const localNameLength = u16(localOffset + 26), localExtraLength = u16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset || localFlags !== flags || localMethod !== method) fail('inconsistent local header');
    if (localNameLength !== nameLength || !bytes.subarray(localOffset + 30, localOffset + 30 + nameLength).every((b, i) => b === bytes[cursor + 46 + i])) fail('local and central names differ');
    if (!(flags & 8) && (u32(localOffset + 14) !== crc || u32(localOffset + 18) !== compressedSize || u32(localOffset + 22) !== size)) fail('local and central sizes differ');
    ranges.push([localOffset, dataOffset + compressedSize]);
    entries.push({ name: name!, size, compressedSize, offset: dataOffset, method, crc });
    cursor = end;
  }
  if (cursor !== eocd) fail('unexpected central directory data');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) fail('overlapping archive entries');
  const result = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressedSize);
    let output: Uint8Array;
    if (entry.method === 0) output = compressed.slice();
    else {
      const parts: Uint8Array[] = [];
      let actual = 0;
      const inflate = new Inflate((chunk: Uint8Array) => {
        actual += chunk.length;
        if (actual > entry.size || actual > ZIP_LIMITS.entryBytes) fail('inflated entry exceeds its declared size');
        parts.push(chunk);
      });
      try {
        // A small input chunk bounds each temporary inflate allocation even for forged size metadata.
        if (!compressed.length) inflate.push(new Uint8Array(), true);
        for (let start = 0; start < compressed.length; start += 512) {
          inflate.push(compressed.subarray(start, start + 512), start + 512 >= compressed.length);
        }
      } catch (error) { fail(error instanceof Error ? error.message : 'invalid DEFLATE stream'); }
      if (actual !== entry.size) fail('inflated size does not match directory');
      output = new Uint8Array(actual);
      let offset = 0;
      for (const part of parts) { output.set(part, offset); offset += part.length; }
    }
    if (output.length !== entry.size || crc32(output) !== entry.crc) fail('entry checksum or size mismatch');
    if (!entry.name.endsWith('/')) result.set(entry.name, output);
  }
  return result;
}
