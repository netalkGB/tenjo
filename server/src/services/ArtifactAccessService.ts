import path from 'node:path';
import type { Pool } from 'pg';

export class ArtifactAccessService {
  constructor(private readonly pool: Pool) {}

  async canReadChatArtifact(
    threadId: string,
    filename: string,
    userId: string
  ): Promise<boolean> {
    const sanitized = path.basename(filename);
    return this.isUserReferencedChatArtifact(threadId, sanitized, userId);
  }

  private async isUserReferencedChatArtifact(
    threadId: string,
    filename: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM "messages" m
        INNER JOIN "threads" t ON t."id" = m."thread_id"
        WHERE m."thread_id" = $1
          AND t."created_by" = $3
          AND (
            strpos(m."data"::text, '/api/chat/threads/' || $1 || '/artifacts/' || $2) > 0
            -- Backward compatibility for messages saved before scoped artifact URLs.
            OR strpos(m."data"::text, '/api/upload/artifacts/' || $2) > 0
          )
      ) AS "exists"
      `,
      [threadId, filename, userId]
    );
    return result.rows[0]?.exists === true;
  }
}
