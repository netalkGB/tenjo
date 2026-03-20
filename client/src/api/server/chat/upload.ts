import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { ClientSideValidationError } from '../../errors/ClientSideValidationError';
import { UploadResponseSchema } from './schemas';
import type { UploadResponse, UploadProgress } from './schemas';
export type { UploadResponse, UploadProgress } from './schemas';

const ALLOWED_MAGIC_NUMBERS: { type: string; bytes: number[] }[] = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] }
];

export async function validateImageFile(file: File): Promise<string> {
  const headerBytes = await readFileHeader(file, 12);

  for (const { type, bytes } of ALLOWED_MAGIC_NUMBERS) {
    if (headerBytes.length < bytes.length) continue;
    const match = bytes.every((b, i) => headerBytes[i] === b);
    if (!match) continue;

    return type;
  }

  throw new ClientSideValidationError(
    'Invalid file type. Only JPEG and PNG images are allowed.'
  );
}

function readFileHeader(file: File, bytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file.slice(0, bytes));
  });
}

export async function uploadImage(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResponse> {
  // Client-side validation first
  await validateImageFile(file);

  try {
    const buffer = await file.arrayBuffer();

    const response = await axios.post<UploadResponse>(
      '/api/upload/image',
      buffer,
      {
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
        onUploadProgress: progressEvent => {
          if (onProgress && progressEvent.total) {
            onProgress({
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              percentage: Math.round(
                (progressEvent.loaded / progressEvent.total) * 100
              )
            });
          }
        }
      }
    );

    const validated = UploadResponseSchema.parse(response.data);
    return validated;
  } catch (error) {
    handleApiError(error);
  }
}
