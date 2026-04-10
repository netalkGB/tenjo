import { BaseRepository } from './BaseRepository';

export interface ImageAnalysisCache {
  id: string;
  image_path: string;
  model: string;
  description: string;
  thread_id: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertImageAnalysisCache {
  image_path: string;
  model: string;
  description: string;
  thread_id: string;
}

const COLUMNS = ['image_path', 'model', 'description', 'thread_id'] as const;

export class ImageAnalysisCacheRepository extends BaseRepository {
  async findByImagePath(
    imagePath: string
  ): Promise<ImageAnalysisCache | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "image_analysis_cache" WHERE "image_path" = $1 LIMIT 1`,
      [imagePath]
    );
    return result.rows[0] as ImageAnalysisCache | undefined;
  }

  async create(data: InsertImageAnalysisCache): Promise<ImageAnalysisCache> {
    return await this.insertReturning<ImageAnalysisCache>(
      'image_analysis_cache',
      { ...data },
      COLUMNS
    );
  }

  async deleteByThreadId(threadId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM "image_analysis_cache" WHERE "thread_id" = $1`,
      [threadId]
    );
    return result.rowCount ?? 0;
  }
}
