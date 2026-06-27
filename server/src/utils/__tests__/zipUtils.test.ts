import { describe, it, expect } from 'vitest';
import { ZipUtils } from '../zipUtils';

interface ParsedZipEntry {
  path: string;
  content: Buffer;
  method: number;
}

function parseStoredZip(buffer: Buffer): ParsedZipEntry[] {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ParsedZipEntry[] = [];
  let cursor = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');

    expect(buffer.readUInt32LE(localHeaderOffset)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const contentStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;

    entries.push({
      path,
      content: buffer.subarray(contentStart, contentStart + compressedSize),
      method
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

describe('ZipUtils', () => {
  it('creates a valid empty ZIP archive', () => {
    const archive = ZipUtils.createArchive([]);

    expect(archive.readUInt32LE(0)).toBe(0x06054b50);
    expect(archive.readUInt16LE(8)).toBe(0);
    expect(archive.readUInt16LE(10)).toBe(0);
  });

  it('stores file paths and content in archive order', () => {
    const archive = ZipUtils.createArchive([
      {
        path: 'src/index.ts',
        content: Buffer.from('export const value = 1;\n', 'utf8')
      },
      {
        path: 'docs/日本語.txt',
        content: Buffer.from('hello', 'utf8'),
        mtime: new Date('2026-01-02T03:04:05Z')
      }
    ]);

    const entries = parseStoredZip(archive);

    expect(entries.map((entry) => entry.path)).toEqual([
      'src/index.ts',
      'docs/日本語.txt'
    ]);
    expect(entries.map((entry) => entry.method)).toEqual([0, 0]);
    expect(entries.map((entry) => entry.content.toString('utf8'))).toEqual([
      'export const value = 1;\n',
      'hello'
    ]);
  });
});
