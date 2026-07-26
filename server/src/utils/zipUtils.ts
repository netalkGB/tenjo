/**
 * Shared ZIP utilities implemented with Node's standard library.
 *
 * Creation uses the STORED method (no compression), so file bytes are copied
 * verbatim. Extraction supports STORED (0) and DEFLATE (8). Output/input is a
 * standard PKZIP archive (local file headers + central directory + EOCD).
 *
 * Scope: 32-bit (no ZIP64), so a single entry and the whole archive must each
 * stay under 4 GiB. That is well within the agent workspace download use case.
 */

import { inflateRawSync } from 'node:zlib';

/** Precomputed CRC-32 (IEEE) lookup table. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encode a Date into the DOS time/date words ZIP uses for last-modified. */
function toDosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (year < 1980) {
    return { time: 0, date: (1 << 5) | 1 };
  }
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

export interface ZipEntry {
  /** POSIX path inside the archive (forward slashes, no leading slash). */
  path: string;
  /** Raw file bytes. */
  content: Buffer;
  /** Last-modified time recorded in the entry; defaults to the DOS epoch. */
  mtime?: Date;
}

const FLAG_UTF8 = 0x0800;
const VERSION = 20;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Build a STORED (uncompressed) ZIP archive from the given entries and return
 * the complete archive as a single Buffer.
 */
function createArchive(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.content);
    const size = entry.content.length;
    const { time, date } = toDosDateTime(entry.mtime ?? new Date(0));

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(SIG_LOCAL, 0);
    localHeader.writeUInt16LE(VERSION, 4);
    localHeader.writeUInt16LE(FLAG_UTF8, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, entry.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(SIG_CENTRAL, 0);
    centralHeader.writeUInt16LE(VERSION, 4);
    centralHeader.writeUInt16LE(VERSION, 6);
    centralHeader.writeUInt16LE(FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + entry.content.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export class ZipExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipExtractError';
  }
}

export interface ExtractArchiveOptions {
  /** Max file entries (directories excluded). Default 200. */
  maxEntries?: number;
  /** Max total uncompressed bytes. Default 20 MiB. */
  maxTotalUncompressedBytes?: number;
  /** Max size of a single uncompressed entry. Default 5 MiB. */
  maxEntryUncompressedBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_TOTAL_UNCOMPRESSED = 20 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_UNCOMPRESSED = 5 * 1024 * 1024;

/** Normalize a ZIP entry path; return null when unsafe or empty. */
function sanitizeZipPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) {
    // Directory markers have no content to extract.
    return normalized.endsWith('/') ? '' : null;
  }
  if (/^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    return null;
  }
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..' || s === '')) {
    return null;
  }
  return segments.join('/');
}

function findEocdOffset(buffer: Buffer): number {
  // EOCD is 22+ bytes; search from the end (comment can be up to 64 KiB).
  const minStart = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minStart; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buffer.length) {
        return i;
      }
    }
  }
  throw new ZipExtractError('Invalid ZIP: end-of-central-directory not found');
}

/** Extract file entries (STORED or DEFLATE). Directory markers are skipped. */
function extractArchive(
  buffer: Buffer,
  options: ExtractArchiveOptions = {}
): ZipEntry[] {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxTotal =
    options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED;
  const maxEntry =
    options.maxEntryUncompressedBytes ?? DEFAULT_MAX_ENTRY_UNCOMPRESSED;

  if (buffer.length < 22) {
    throw new ZipExtractError('Invalid ZIP: archive too small');
  }

  const eocdOffset = findEocdOffset(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (entryCount > maxEntries * 2) {
    // Allow directory markers roughly doubling the file cap.
    throw new ZipExtractError(
      `ZIP has too many entries (${entryCount}; max ~${maxEntries} files)`
    );
  }

  const entries: ZipEntry[] = [];
  let totalUncompressed = 0;
  let cursor = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buffer.length) {
      throw new ZipExtractError('Invalid ZIP: truncated central directory');
    }
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new ZipExtractError('Invalid ZIP: bad central directory signature');
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) {
      throw new ZipExtractError('Invalid ZIP: truncated entry name');
    }
    const rawName = buffer.subarray(nameStart, nameEnd).toString('utf8');
    cursor = nameEnd + extraLength + commentLength;

    if (rawName.endsWith('/')) {
      continue;
    }

    const safePath = sanitizeZipPath(rawName);
    if (safePath === null) {
      throw new ZipExtractError(`Invalid ZIP entry path: ${rawName}`);
    }
    if (safePath === '') {
      continue;
    }

    if (uncompressedSize > maxEntry) {
      throw new ZipExtractError(
        `ZIP entry too large: ${safePath} (${uncompressedSize} bytes)`
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotal) {
      throw new ZipExtractError(
        `ZIP total uncompressed size exceeds limit (${maxTotal} bytes)`
      );
    }

    if (localHeaderOffset + 30 > buffer.length) {
      throw new ZipExtractError('Invalid ZIP: truncated local header');
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== SIG_LOCAL) {
      throw new ZipExtractError('Invalid ZIP: bad local header signature');
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new ZipExtractError(`Invalid ZIP: truncated data for ${safePath}`);
    }
    const compressed = buffer.subarray(dataStart, dataEnd);

    let content: Buffer;
    if (method === METHOD_STORED) {
      content = Buffer.from(compressed);
    } else if (method === METHOD_DEFLATE) {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: maxEntry });
      } catch {
        throw new ZipExtractError(`Failed to inflate entry: ${safePath}`);
      }
    } else {
      throw new ZipExtractError(
        `Unsupported ZIP compression method ${method} for ${safePath}`
      );
    }

    if (content.length > maxEntry) {
      throw new ZipExtractError(
        `ZIP entry too large after inflate: ${safePath}`
      );
    }

    entries.push({ path: safePath, content });

    if (entries.length > maxEntries) {
      throw new ZipExtractError(
        `ZIP has too many file entries (max ${maxEntries})`
      );
    }
  }

  return entries;
}

export const ZipUtils = {
  createArchive,
  extractArchive
} as const;
