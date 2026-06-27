import type { MessageRequest } from 'tenjo-chat-engine';
import { BaseRepository } from './BaseRepository';

export interface AgentMessagePlan {
  summary: string | null;
  todos: { text: string; status: 'pending' | 'in_progress' | 'completed' }[];
  status: 'proposed' | 'running' | 'done';
}

export interface AgentMessage {
  id: string;
  project_id: string;
  seq: string;
  role: string;
  source: string;
  data: MessageRequest;
  plan: AgentMessagePlan | null;
  model: string | null;
  provider: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertAgentMessage {
  id?: string;
  project_id: string;
  role: string;
  source: string;
  data: MessageRequest;
  plan?: AgentMessagePlan | null;
  model?: string | null;
  provider?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
}

const COLUMNS = [
  'id',
  'project_id',
  'role',
  'source',
  'data',
  'plan',
  'model',
  'provider',
  'created_by',
  'updated_by'
] as const;

export class AgentMessageRepository extends BaseRepository {
  async append(messageData: InsertAgentMessage): Promise<AgentMessage> {
    return await this.withTransaction(async (client) => {
      const newMessage = await this.insertReturning<AgentMessage>(
        'agent_message',
        {
          ...messageData,
          updated_by: messageData.updated_by ?? messageData.created_by
        },
        COLUMNS,
        client
      );
      await client.query(
        `UPDATE "agent_project"
            SET "updated_at" = now(), "updated_by" = COALESCE($2, "updated_by")
          WHERE "id" = $1`,
        [messageData.project_id, messageData.created_by ?? null]
      );
      return newMessage;
    });
  }

  async findById(id: string): Promise<AgentMessage | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "agent_message" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as AgentMessage | undefined;
  }

  async listByProject(projectId: string): Promise<AgentMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM "agent_message" WHERE "project_id" = $1 ORDER BY "seq" ASC`,
      [projectId]
    );
    return result.rows as AgentMessage[];
  }

  async setPlanForLatestAssistant(
    projectId: string,
    plan: AgentMessagePlan,
    updatedBy?: string | null
  ): Promise<AgentMessage | undefined> {
    return await this.withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE "agent_message"
            SET "plan" = $1, "updated_at" = now(), "updated_by" = COALESCE($3, "updated_by")
          WHERE "id" = (
            SELECT "id" FROM "agent_message"
              WHERE "project_id" = $2 AND "role" = 'assistant'
              ORDER BY "seq" DESC LIMIT 1
          )
        RETURNING *`,
        [JSON.stringify(plan), projectId, updatedBy ?? null]
      );
      const updated = result.rows[0] as AgentMessage | undefined;
      if (updated) {
        await client.query(
          `UPDATE "agent_project"
              SET "updated_at" = now(), "updated_by" = COALESCE($2, "updated_by")
            WHERE "id" = $1`,
          [projectId, updatedBy ?? null]
        );
      }
      return updated;
    });
  }

  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM "agent_message" WHERE "project_id" = $1 RETURNING "id"`,
      [projectId]
    );
    return result.rows.length;
  }
}
