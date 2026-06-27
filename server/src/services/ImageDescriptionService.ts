import path from 'node:path';
import { createChatClient } from '../factories/chatClientFactory';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';
import logger from '../logger';

/** Image extensions we text-ify on upload (others are kept as raw files only). */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

/** Whether a file name looks like an image we can describe. */
export function isImageFileName(name: string): boolean {
  return path.extname(name).toLowerCase() in IMAGE_MIME_BY_EXT;
}

/** MIME type for an image file name (defaults to PNG). */
export function imageMimeType(name: string): string {
  return IMAGE_MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'image/png';
}

const FALLBACK_DESCRIPTION =
  '[This image could NOT be read as text: the current model has no vision ' +
  'capability (or the description timed out). You cannot see this image, and ' +
  'NO tool can recover its contents — do NOT open it with code (PIL/Pillow, ' +
  'OpenCV, ImageMagick, etc.) and do NOT search the web for it; those cannot ' +
  'describe a local picture. Proceed using only what the user wrote in their ' +
  'message. If the image content is essential to the task, ask the user to ' +
  'describe it in text rather than trying to analyze the file yourself.]';

/** Outcome of an image-description attempt. */
export interface ImageDescriptionResult {
  /** The plain-text description, or {@link FALLBACK_DESCRIPTION} on failure. */
  text: string;
  /** True only when a vision-capable model produced a real description. */
  ok: boolean;
}

const SYSTEM_PROMPT =
  'You convert an image into a thorough PLAIN-TEXT description so a text-only ' +
  'agent can use it as context. Transcribe any visible text verbatim, ' +
  'and describe layout, UI elements, diagrams, tables/data, colors and any ' +
  'other notable details. Output only the description. Do not use <think> tags.';

/**
 * Describe an image as plain text via the configured model, so a non-vision
 * coding agent can still use an uploaded image as context. Bounded (≤60s, then
 * abort) and never throws — returns a fallback note on any failure (incl. a
 * model that doesn't support vision). Mirrors {@link generateTitle}'s one-shot
 * pattern.
 */
export async function describeImageToText(
  bytes: Buffer,
  mimeType: string,
  modelConfig: ModelConfig | null
): Promise<ImageDescriptionResult> {
  if (!modelConfig) {
    return { text: FALLBACK_DESCRIPTION, ok: false };
  }

  try {
    const chatClient = createChatClient({
      config: modelConfig,
      systemPrompt: {
        role: 'system',
        content: [{ type: 'text', text: SYSTEM_PROMPT }]
      }
    });

    const TIMEOUT_MS = 60000;
    const abortController = new AbortController();
    let collected = '';

    const timeout = setTimeout(() => {
      abortController.abort();
    }, TIMEOUT_MS);

    chatClient.setThinkingHandler(() => {});
    chatClient.setMessageHandler((chunk: string) => {
      collected += chunk;
    });

    const dataUri = `data:${mimeType};base64,${bytes.toString('base64')}`;
    try {
      await chatClient.sendMessage(
        'Describe this image in detail as plain text.',
        [dataUri],
        { signal: abortController.signal }
      );
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    const description = collected.trim();
    return description
      ? { text: description, ok: true }
      : { text: FALLBACK_DESCRIPTION, ok: false };
  } catch (error) {
    logger.warn('Failed to describe image via LLM, using fallback', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { text: FALLBACK_DESCRIPTION, ok: false };
  }
}
