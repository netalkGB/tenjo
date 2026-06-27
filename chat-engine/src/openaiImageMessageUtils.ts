import * as fs from 'fs';
import * as path from 'path';
import { ChatApiValidationError } from './ChatApiError';
import type { ChatCompletionMessageRequest } from './OpenAIChatApiClient';

const SUPPORTED_IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function convertFilePathToDataUri(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_IMAGE_EXTENSIONS[ext];
  if (!mimeType) {
    throw new ChatApiValidationError(`Unsupported image format: ${ext}`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function isFilePath(url: string): boolean {
  return (
    !url.startsWith('data:') &&
    !url.startsWith('http://') &&
    !url.startsWith('https://')
  );
}

export function resolveImageUrls(
  messages: ChatCompletionMessageRequest[]
): ChatCompletionMessageRequest[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const resolvedContent = msg.content.map((part) => {
      if (part.type !== 'image_url' || !isFilePath(part.image_url.url)) {
        return part;
      }
      return {
        ...part,
        image_url: {
          ...part.image_url,
          url: convertFilePathToDataUri(part.image_url.url),
        },
      };
    });

    return { ...msg, content: resolvedContent };
  });
}
