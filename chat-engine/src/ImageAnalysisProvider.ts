/**
 * Interface for image analysis caching.
 * Server implements this with DB-backed storage;
 * chat-engine uses it for context compression.
 */
export interface ImageAnalysisProvider {
  getCachedDescription(imagePath: string): Promise<string | undefined>;
  cacheDescription(imagePath: string, description: string): Promise<void>;
}

/**
 * Resolves an image URL (e.g. artifact path) to a data URI
 * that can be sent to an LLM for analysis.
 */
export type ImageUrlResolver = (url: string) => Promise<string>;
