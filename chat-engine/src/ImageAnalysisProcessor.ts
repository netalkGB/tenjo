import type { ChatApiClient } from './ChatApiClient';
import type { MessageContent, MessageRequest } from './ChatClient';
import { ChatClient, MessageRole } from './ChatClient';
import type {
  ImageAnalysisProvider,
  ImageUrlResolver,
} from './ImageAnalysisProvider';

const EXTRACTION_SYSTEM_PROMPT =
  'You are an image description assistant. Describe the given image in detail. ' +
  'Include all visible text, layout, colors, objects, and any other relevant information. ' +
  'This description will be used as a text substitute for the image in future conversation context. ' +
  'Respond with the description only, no preamble.';

interface ImageToAnalyze {
  messageIndex: number;
  contentIndex: number;
  imagePath: string;
}

export class ImageAnalysisProcessor {
  constructor(
    private provider: ImageAnalysisProvider,
    private chatApiClientFactory: () => ChatApiClient,
    private imageUrlResolver: ImageUrlResolver,
    private onStatusChange?: (analyzing: boolean) => void
  ) {}

  /**
   * Process context messages by replacing past image_url content
   * with cached or freshly extracted text descriptions.
   * The last user message in the array is NOT processed
   * (it is the current message whose images should be sent as-is).
   */
  async processContextMessages(
    messages: MessageRequest[]
  ): Promise<MessageRequest[]> {
    const imagesToAnalyze = this.collectImagesToAnalyze(messages);
    if (imagesToAnalyze.length === 0) {
      return messages;
    }

    this.onStatusChange?.(true);
    try {
      // Check cache for all images
      const cacheResults = await Promise.all(
        imagesToAnalyze.map(async (img) => ({
          ...img,
          cached: await this.provider.getCachedDescription(img.imagePath),
        }))
      );

      const cacheMisses = cacheResults.filter((r) => r.cached === undefined);

      // Extract descriptions for cache misses in parallel
      if (cacheMisses.length > 0) {
        const extractions = await Promise.all(
          cacheMisses.map(async (miss) => {
            try {
              const description = await this.extractDescription(
                miss.imagePath
              );
              await this.provider.cacheDescription(
                miss.imagePath,
                description
              );
              return { ...miss, cached: description };
            } catch {
              // Fallback: strip image on extraction failure
              return { ...miss, cached: '' };
            }
          })
        );

        // Merge extractions back into cache results
        for (const extraction of extractions) {
          const idx = cacheResults.findIndex(
            (r) =>
              r.messageIndex === extraction.messageIndex &&
              r.contentIndex === extraction.contentIndex
          );
          if (idx !== -1) {
            cacheResults[idx] = extraction;
          }
        }
      }

      // Build replacement map: messageIndex -> contentIndex -> description
      const replacements = new Map<number, Map<number, string>>();
      for (const result of cacheResults) {
        if (!replacements.has(result.messageIndex)) {
          replacements.set(result.messageIndex, new Map());
        }
        replacements.get(result.messageIndex)!.set(
          result.contentIndex,
          result.cached ?? ''
        );
      }

      // Apply replacements
      return messages.map((msg, msgIdx) => {
        const contentReplacements = replacements.get(msgIdx);
        if (!contentReplacements || !Array.isArray(msg.content)) {
          return msg;
        }

        const newContent: MessageContent[] = [];
        for (let i = 0; i < msg.content.length; i++) {
          const replacement = contentReplacements.get(i);
          if (replacement !== undefined) {
            if (replacement !== '') {
              newContent.push({
                type: 'text',
                text: `[Image description: ${replacement}]`,
              });
            }
            // Empty replacement = strip (extraction failed)
          } else {
            newContent.push(msg.content[i]);
          }
        }

        // If all content was replaced/stripped, ensure at least empty text
        if (newContent.length === 0) {
          newContent.push({ type: 'text', text: '' });
        }

        return { ...msg, content: newContent };
      });
    } finally {
      this.onStatusChange?.(false);
    }
  }

  /**
   * Collect all image_url content items from past user messages.
   * All context messages are considered "past" (the current user message
   * is not included in context messages).
   */
  private collectImagesToAnalyze(
    messages: MessageRequest[]
  ): ImageToAnalyze[] {
    const images: ImageToAnalyze[] = [];

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
      const msg = messages[msgIdx];
      if (msg.role !== MessageRole.USER || !Array.isArray(msg.content)) {
        continue;
      }

      for (let cIdx = 0; cIdx < msg.content.length; cIdx++) {
        const content = msg.content[cIdx];
        if (content.type === 'image_url') {
          images.push({
            messageIndex: msgIdx,
            contentIndex: cIdx,
            imagePath: content.image_url.url,
          });
        }
      }
    }

    return images;
  }

  private async extractDescription(imagePath: string): Promise<string> {
    const dataUri = await this.imageUrlResolver(imagePath);

    const chatApiClient = this.chatApiClientFactory();
    const chatClient = new ChatClient(chatApiClient);

    // Suppress stream handlers -- we only need the final response
    chatClient.setMessageHandler(() => {});
    chatClient.setThinkingHandler(() => {});
    chatClient.setReasoningHandler(() => {});

    chatClient.setSystemPrompt({
      role: MessageRole.SYSTEM,
      content: EXTRACTION_SYSTEM_PROMPT,
    });

    await chatClient.sendMessage(undefined, [dataUri]);

    // The last message should be the assistant's response
    const msgs = chatClient.getMessages();
    const assistantMsg = msgs[msgs.length - 1];
    if (assistantMsg && assistantMsg.role === MessageRole.ASSISTANT) {
      const content = assistantMsg.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('');
      }
    }

    return '';
  }
}
