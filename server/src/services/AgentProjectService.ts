import type {
  AgentProject,
  AgentProjectMode,
  AgentProjectModelSnapshot,
  AgentProjectRepository,
  PaginatedAgentProjectsResult
} from '../repositories/AgentProjectRepository';

export interface UpdateAgentProjectParams {
  title?: string;
  pinned?: boolean;
  mode?: string;
}

export class AgentProjectService {
  constructor(private readonly agentProjectRepo: AgentProjectRepository) {}

  async createProject(
    userId: string,
    modeInput: string | undefined,
    model: AgentProjectModelSnapshot
  ): Promise<AgentProject | undefined> {
    return this.agentProjectRepo.create({
      title: '-',
      status: 'queued',
      mode: this.normalizeMode(modeInput),
      model_id: model.id,
      model: model.model,
      provider: model.provider,
      model_base_url: model.baseUrl,
      created_by: userId,
      updated_by: userId
    });
  }

  async findByIdAndUser(
    projectId: string,
    userId: string
  ): Promise<AgentProject | undefined> {
    return this.agentProjectRepo.findByIdAndUser(projectId, userId);
  }

  async listByUser(
    userId: string,
    pageSize: number,
    pageNumber: number,
    search?: string
  ): Promise<PaginatedAgentProjectsResult> {
    return this.agentProjectRepo.listByUser(
      userId,
      pageSize,
      pageNumber,
      search
    );
  }

  async updateProject(
    projectId: string,
    params: UpdateAgentProjectParams
  ): Promise<AgentProject | undefined> {
    const patch: {
      title?: string;
      pinned?: boolean;
      mode?: AgentProjectMode;
    } = {};

    if (typeof params.title === 'string') {
      patch.title = params.title.slice(0, 150);
    }
    if (typeof params.pinned === 'boolean') {
      patch.pinned = params.pinned;
    }
    if (params.mode === 'plan' || params.mode === 'steer') {
      patch.mode = params.mode;
    }

    return this.agentProjectRepo.update(projectId, patch);
  }

  async deleteProject(projectId: string): Promise<boolean> {
    return this.agentProjectRepo.delete(projectId);
  }

  private normalizeMode(mode?: string): AgentProjectMode {
    return mode === 'steer' ? 'steer' : 'plan';
  }
}
