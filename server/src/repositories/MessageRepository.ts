import { BaseRepository } from './BaseRepository';

export interface Message {
  id: string;
  thread_id: string;
  parent_message_id: string | null;
  selected_child_id: string | null;
  data: unknown;
  source: 'user' | 'assistant';
  model: string | null;
  provider: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertMessage {
  id?: string;
  thread_id: string;
  parent_message_id?: string | null;
  selected_child_id?: string | null;
  data: unknown;
  source: 'user' | 'assistant';
  model?: string | null;
  provider?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export type UpdateMessage = Partial<InsertMessage>;

const COLUMNS = [
  'id',
  'thread_id',
  'parent_message_id',
  'selected_child_id',
  'data',
  'source',
  'model',
  'provider',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export class MessageRepository extends BaseRepository {
  async findAll(): Promise<Message[]> {
    const result = await this.pool.query(`SELECT * FROM "messages"`);
    return result.rows as Message[];
  }

  async findById(id: string): Promise<Message | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "messages" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as Message | undefined;
  }

  async create(messageData: InsertMessage): Promise<Message> {
    return await this.insertReturning<Message>(
      'messages',
      { ...messageData },
      COLUMNS
    );
  }

  async addMessage(messageData: InsertMessage): Promise<Message> {
    return await this.withTransaction(async (client) => {
      const newMessage = await this.insertReturning<Message>(
        'messages',
        { ...messageData },
        COLUMNS,
        client
      );

      if (messageData.parent_message_id) {
        await client.query(
          `UPDATE "messages" SET "selected_child_id" = $1 WHERE "id" = $2`,
          [newMessage.id, messageData.parent_message_id]
        );
      }

      if (newMessage.thread_id) {
        await client.query(
          `UPDATE "threads" SET "current_leaf_message_id" = $1, "updated_at" = $2, "updated_by" = $3 WHERE "id" = $4`,
          [
            newMessage.id,
            new Date(),
            messageData.created_by ?? null,
            newMessage.thread_id
          ]
        );
      }

      return newMessage;
    });
  }

  async update(
    id: string,
    messageData: UpdateMessage
  ): Promise<Message | undefined> {
    return await this.updateReturning<Message>(
      'messages',
      id,
      { ...messageData },
      COLUMNS
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "messages" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }

  async deleteByThreadId(threadId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM "messages" WHERE "thread_id" = $1 RETURNING *`,
      [threadId]
    );
    return result.rows.length;
  }

  async switchBranch(parentId: string, targetChildId: string): Promise<void> {
    await this.pool.query(
      `UPDATE "messages" SET "selected_child_id" = $1 WHERE "id" = $2`,
      [targetChildId, parentId]
    );
  }

  async findPath(startId: string): Promise<Message[]> {
    const query = `
      WITH RECURSIVE

      -- 1. Traverse into the past (Ancestors) - unchanged
      ancestors AS (
        SELECT *, 0 AS depth
        FROM "messages"
        WHERE id = $1

        UNION ALL

        SELECT p.*, a.depth - 1
        FROM "messages" p
        INNER JOIN ancestors a ON p.id = a.parent_message_id
      ),

      -- 2. Traverse into the future (Descendants)
      descendants AS (
        SELECT m.*, 1 AS depth
        FROM "messages" m
        JOIN "messages" parent ON parent.id = $1
        WHERE m.parent_message_id = $1
          AND (
            m.id = parent.selected_child_id
            OR
            (parent.selected_child_id IS NULL AND m.id = (
                SELECT id FROM "messages"
                WHERE parent_message_id = $1
                ORDER BY created_at DESC LIMIT 1
            ))
          )

        UNION ALL

        SELECT c.*, d.depth + 1
        FROM descendants d
        JOIN "messages" c ON c.parent_message_id = d.id
        WHERE (
           c.id = d.selected_child_id
           OR
           (d.selected_child_id IS NULL AND c.id = (
              SELECT id FROM "messages"
              WHERE parent_message_id = d.id
              ORDER BY created_at DESC LIMIT 1
           ))
        )
      ),

      chain AS (
        SELECT * FROM ancestors
        UNION ALL
        SELECT * FROM descendants
      )

      SELECT * FROM chain ORDER BY depth ASC;
    `;

    const result = await this.pool.query(query, [startId]);
    return result.rows as Message[];
  }

  async getBranchStatus(parentId: string | null, currentChildId?: string) {
    // Treat empty string as invalid input
    if (parentId === '') return null;

    // If parentId is null, we need to get thread_id from currentChildId
    let threadId: string | null = null;
    if (parentId === null && currentChildId) {
      const currentChild = await this.findById(currentChildId);
      threadId = currentChild?.thread_id ?? null;
    }

    // Query 1: Get siblings (required)
    const siblingsResult =
      parentId === null
        ? await this.pool.query(
            `SELECT "id", "created_at" FROM "messages" WHERE "parent_message_id" IS NULL AND "thread_id" = $1 ORDER BY "created_at"`,
            [threadId]
          )
        : await this.pool.query(
            `SELECT "id", "created_at" FROM "messages" WHERE "parent_message_id" = $1 ORDER BY "created_at"`,
            [parentId]
          );

    const siblings = siblingsResult.rows as { id: string; created_at: Date }[];
    if (siblings.length === 0) return null;

    // Query 2: Get parent info (skip if parentId is null)
    const parent = parentId ? await this.findById(parentId) : null;
    const selectedId = parent?.selected_child_id;

    let activeId = selectedId;

    // If a "currently displayed" specification (currentChildId) exists,
    // prioritize it over the DB saved state (selectedId)
    if (currentChildId) {
      activeId = currentChildId;
    }
    // If no specification and the DB ID is invalid (deleted, etc.), use the latest
    else if (!siblings.some((s) => s.id === activeId)) {
      activeId = siblings[siblings.length - 1].id;
    }

    const currentIndex = siblings.findIndex((s) => s.id === activeId);

    // Safety measure (default to 0 if an ID not in the list is passed)
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;

    return {
      current: safeIndex + 1,
      total: siblings.length,
      siblings: siblings.map((s) => s.id)
    };
  }
}
