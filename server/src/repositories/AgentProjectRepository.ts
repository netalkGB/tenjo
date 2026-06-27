import type { CompactionState, QueuedItem } from 'tenjo-chat-engine';
import { BaseRepository } from './BaseRepository';

export type AgentProjectStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'queued'
  | 'idle';

export type AgentProjectMode = 'plan' | 'steer';

export interface AgentProjectModelSnapshot {
  id: string;
  provider: string;
  model: string;
  baseUrl: string;
}

export interface AgentProject {
  id: string;
  title: string;
  status: AgentProjectStatus;
  mode: AgentProjectMode;
  pinned: boolean;
  model_id: string | null;
  model: string | null;
  provider: string | null;
  model_base_url: string | null;
  compaction: CompactionState;
  queue: QueuedItem[];
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertAgentProject {
  id?: string;
  title?: string;
  status?: AgentProjectStatus;
  mode?: AgentProjectMode;
  pinned?: boolean;
  model_id?: string | null;
  model?: string | null;
  provider?: string | null;
  model_base_url?: string | null;
  compaction?: CompactionState;
  queue?: QueuedItem[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export type UpdateAgentProject = Partial<InsertAgentProject>;

export type PaginatedAgentProjectsResult = {
  projects: AgentProject[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
};

const COLUMNS = [
  'id',
  'title',
  'status',
  'mode',
  'pinned',
  'model_id',
  'model',
  'provider',
  'model_base_url',
  'compaction',
  'queue',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export class AgentProjectRepository extends BaseRepository {
  async findById(id: string): Promise<AgentProject | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "agent_project" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as AgentProject | undefined;
  }

  async findByIdAndUser(
    id: string,
    userId: string
  ): Promise<AgentProject | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "agent_project" WHERE "id" = $1 AND "created_by" = $2`,
      [id, userId]
    );
    return result.rows[0] as AgentProject | undefined;
  }

  // node-postgres treats JS arrays as Postgres arrays unless jsonb values are encoded.
  private serialize(
    data: InsertAgentProject | UpdateAgentProject
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    if (data.compaction !== undefined) {
      out.compaction = JSON.stringify(data.compaction);
    }
    if (data.queue !== undefined) {
      out.queue = JSON.stringify(data.queue);
    }
    return out;
  }

  async create(
    projectData: InsertAgentProject
  ): Promise<AgentProject | undefined> {
    return await this.insertReturning<AgentProject>(
      'agent_project',
      this.serialize(projectData),
      COLUMNS
    );
  }

  async update(
    id: string,
    projectData: UpdateAgentProject
  ): Promise<AgentProject | undefined> {
    return await this.updateReturning<AgentProject>(
      'agent_project',
      id,
      { ...this.serialize(projectData), updated_at: new Date() },
      COLUMNS
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "agent_project" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }

  async findPinned(userId: string): Promise<AgentProject[]> {
    const result = await this.pool.query(
      `SELECT * FROM "agent_project" WHERE "pinned" = true AND "created_by" = $1 ORDER BY "updated_at" DESC`,
      [userId]
    );
    return result.rows as AgentProject[];
  }

  async pin(id: string, pinned: boolean): Promise<AgentProject | undefined> {
    return await this.update(id, { pinned });
  }

  async listByUser(
    userId: string,
    pageSize: number,
    pageNumber: number,
    searchWord?: string
  ): Promise<PaginatedAgentProjectsResult> {
    const searchPattern = `%${searchWord || ''}%`;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM "agent_project" WHERE "created_by" = $1 AND "title" LIKE $2`,
      [userId, searchPattern]
    );
    const totalCount = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);

    const offset = (pageNumber - 1) * pageSize;
    const result = await this.pool.query(
      `SELECT * FROM "agent_project" WHERE "created_by" = $1 AND "title" LIKE $2 ORDER BY "updated_at" DESC LIMIT $3 OFFSET $4`,
      [userId, searchPattern, pageSize, offset]
    );

    return {
      projects: result.rows as AgentProject[],
      totalPages,
      currentPage: pageNumber,
      totalCount
    };
  }
}
