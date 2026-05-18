import { ClientSideValidationError } from '@/api/errors/ClientSideValidationError';

const RASTER_MAGIC_NUMBERS: { type: string; bytes: number[] }[] = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] }
];

function readFileHead(file: File, bytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file.slice(0, bytes));
  });
}

export async function detectBrandingMimeType(file: File): Promise<string> {
  const headerBytes = await readFileHead(file, 1024);

  for (const { type, bytes } of RASTER_MAGIC_NUMBERS) {
    if (headerBytes.length < bytes.length) continue;
    if (bytes.every((b, i) => headerBytes[i] === b)) {
      return type;
    }
  }

  // SVG is text — sniff the first chunk for an `<svg` tag.
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(headerBytes)
    .toLowerCase();
  if (/<svg[\s>]/.test(text)) {
    return 'image/svg+xml';
  }

  throw new ClientSideValidationError(
    'Invalid file type. Only JPEG, PNG, and SVG images are allowed.'
  );
}
