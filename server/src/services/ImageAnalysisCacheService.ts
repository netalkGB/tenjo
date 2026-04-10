import type { ImageAnalysisProvider } from 'tenjo-chat-engine';
import logger from '../logger';
import type { ImageAnalysisCacheRepository } from '../repositories/ImageAnalysisCacheRepository';

/**
 * Creates an ImageAnalysisProvider bound to a specific thread and model.
 * chat-engine only knows about image paths and descriptions;
 * thread/model context is the server's responsibility.
 */
export function createImageAnalysisProvider(
  repo: ImageAnalysisCacheRepository,
  threadId: string,
  model: string
): ImageAnalysisProvider {
  return {
    async getCachedDescription(imagePath: string): Promise<string | undefined> {
      const cached = await repo.findByImagePath(imagePath);
      if (cached) {
        logger.debug('Image analysis cache hit', { imagePath });
        return cached.description;
      }
      logger.debug('Image analysis cache miss', { imagePath });
      return undefined;
    },

    async cacheDescription(
      imagePath: string,
      description: string
    ): Promise<void> {
      await repo.create({
        image_path: imagePath,
        model,
        description,
        thread_id: threadId
      });
      logger.debug('Cached image analysis description', { imagePath, model });
    }
  };
}
