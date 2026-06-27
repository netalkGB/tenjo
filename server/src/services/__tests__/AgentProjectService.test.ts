import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentProjectService } from '../AgentProjectService';
import type {
  AgentProject,
  AgentProjectRepository
} from '../../repositories/AgentProjectRepository';

function createMockRepo() {
  return {
    create: vi.fn(),
    findByIdAndUser: vi.fn(),
    listByUser: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  };
}

const MODEL_SNAPSHOT = {
  id: 'model-1',
  provider: 'openai',
  model: 'gpt-4.1',
  baseUrl: 'https://api.openai.com'
};

function buildProject(overrides: Partial<AgentProject> = {}): AgentProject {
  return {
    id: 'project-1',
    title: '-',
    status: 'queued',
    mode: 'plan',
    pinned: false,
    model_id: 'model-1',
    model: 'gpt-4.1',
    provider: 'openai',
    model_base_url: 'https://api.openai.com',
    compaction: { summary: '', coveredCount: 0 },
    queue: [],
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('AgentProjectService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: AgentProjectService;

  beforeEach(() => {
    repo = createMockRepo();
    service = new AgentProjectService(
      repo as unknown as AgentProjectRepository
    );
  });

  describe('createProject', () => {
    it('should normalize steer mode', async () => {
      const project = buildProject({ mode: 'steer' });
      repo.create.mockResolvedValue(project);

      const result = await service.createProject(
        'user-1',
        'steer',
        MODEL_SNAPSHOT
      );

      expect(result).toEqual(project);
      expect(repo.create).toHaveBeenCalledWith({
        title: '-',
        status: 'queued',
        mode: 'steer',
        model_id: 'model-1',
        model: 'gpt-4.1',
        provider: 'openai',
        model_base_url: 'https://api.openai.com',
        created_by: 'user-1',
        updated_by: 'user-1'
      });
    });

    it('should fall back to plan mode', async () => {
      repo.create.mockResolvedValue(buildProject());

      await service.createProject('user-1', 'unknown', MODEL_SNAPSHOT);

      expect(repo.create).toHaveBeenCalledWith({
        title: '-',
        status: 'queued',
        mode: 'plan',
        model_id: 'model-1',
        model: 'gpt-4.1',
        provider: 'openai',
        model_base_url: 'https://api.openai.com',
        created_by: 'user-1',
        updated_by: 'user-1'
      });
    });
  });

  describe('updateProject', () => {
    it('should trim update params to the repository patch shape', async () => {
      const project = buildProject({
        title: 'renamed',
        pinned: true,
        mode: 'steer'
      });
      repo.update.mockResolvedValue(project);

      const result = await service.updateProject('project-1', {
        title: 'renamed',
        pinned: true,
        mode: 'steer'
      });

      expect(result).toEqual(project);
      expect(repo.update).toHaveBeenCalledWith('project-1', {
        title: 'renamed',
        pinned: true,
        mode: 'steer'
      });
    });

    it('should ignore invalid mode values', async () => {
      repo.update.mockResolvedValue(buildProject());

      await service.updateProject('project-1', {
        title: undefined,
        pinned: undefined,
        mode: 'invalid'
      });

      expect(repo.update).toHaveBeenCalledWith('project-1', {});
    });

    it('should truncate title to 150 characters', async () => {
      repo.update.mockResolvedValue(buildProject());
      const longTitle = 'a'.repeat(200);

      await service.updateProject('project-1', {
        title: longTitle
      });

      expect(repo.update).toHaveBeenCalledWith('project-1', {
        title: 'a'.repeat(150)
      });
    });
  });

  describe('findByIdAndUser', () => {
    it('should delegate to repository with project and user ids', async () => {
      const project = buildProject();
      repo.findByIdAndUser.mockResolvedValue(project);

      const result = await service.findByIdAndUser('project-1', 'user-1');

      expect(result).toEqual(project);
      expect(repo.findByIdAndUser).toHaveBeenCalledWith('project-1', 'user-1');
    });
  });

  describe('listByUser', () => {
    it('should delegate to repository with pagination and search params', async () => {
      const resultValue = {
        projects: [buildProject()],
        totalPages: 1,
        currentPage: 2,
        totalCount: 1
      };
      repo.listByUser.mockResolvedValue(resultValue);

      const result = await service.listByUser('user-1', 20, 2, 'alpha');

      expect(result).toEqual(resultValue);
      expect(repo.listByUser).toHaveBeenCalledWith('user-1', 20, 2, 'alpha');
    });
  });

  describe('deleteProject', () => {
    it('should delegate to repository delete', async () => {
      repo.delete.mockResolvedValue(true);

      const result = await service.deleteProject('project-1');

      expect(result).toBe(true);
      expect(repo.delete).toHaveBeenCalledWith('project-1');
    });
  });
});
