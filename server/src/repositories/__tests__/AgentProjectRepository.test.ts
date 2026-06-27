import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentProjectRepository } from '../AgentProjectRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';

describe('AgentProjectRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: AgentProjectRepository;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'agentproj' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();
    repo = new AgentProjectRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  it('creates a project with sensible defaults', async () => {
    const project = await repo.create({ created_by: USER_A });
    expect(project).toBeDefined();
    expect(project!.id).toBeDefined();
    expect(project!.title).toBe('-');
    expect(project!.status).toBe('queued');
    expect(project!.mode).toBe('plan');
    expect(project!.pinned).toBe(false);
    expect(project!.model_id).toBeNull();
    expect(project!.model).toBeNull();
    expect(project!.provider).toBeNull();
    expect(project!.model_base_url).toBeNull();
    // jsonb defaults are returned as parsed objects.
    expect(project!.compaction).toEqual({ summary: '', coveredCount: 0 });
    expect(project!.queue).toEqual([]);
  });

  it('scopes lookups to the owning user', async () => {
    const project = await repo.create({ created_by: USER_A });
    expect(await repo.findByIdAndUser(project!.id, USER_A)).toBeDefined();
    expect(await repo.findByIdAndUser(project!.id, USER_B)).toBeUndefined();
  });

  it('round-trips compaction and queue jsonb through update', async () => {
    const project = await repo.create({ created_by: USER_A });
    const compaction = { summary: 'did things', coveredCount: 3 };
    const queue = [
      {
        id: 'q1',
        text: 'next task',
        status: 'queued' as const,
        enqueuedAt: 123
      }
    ];
    const updated = await repo.update(project!.id, {
      status: 'running',
      mode: 'steer',
      model_id: 'model-1',
      model: 'gpt-4.1',
      provider: 'openai',
      model_base_url: 'https://api.openai.com',
      compaction,
      queue
    });
    expect(updated!.status).toBe('running');
    expect(updated!.mode).toBe('steer');
    expect(updated!.model_id).toBe('model-1');
    expect(updated!.model).toBe('gpt-4.1');
    expect(updated!.provider).toBe('openai');
    expect(updated!.model_base_url).toBe('https://api.openai.com');
    expect(updated!.compaction).toEqual(compaction);
    expect(updated!.queue).toEqual(queue);
  });

  it('pins and lists pinned projects for the user', async () => {
    const a = await repo.create({ created_by: USER_A });
    await repo.create({ created_by: USER_A });
    await repo.pin(a!.id, true);
    const pinned = await repo.findPinned(USER_A);
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe(a!.id);
  });

  it('lists a user projects with pagination metadata', async () => {
    await repo.create({ created_by: USER_A, title: 'alpha' });
    await repo.create({ created_by: USER_A, title: 'beta' });
    await repo.create({ created_by: USER_B, title: 'other' });
    const result = await repo.listByUser(USER_A, 50, 1);
    expect(result.totalCount).toBe(2);
    expect(result.projects).toHaveLength(2);
  });

  it('should filter projects by title search word and paginate the result', async () => {
    await repo.create({ created_by: USER_A, title: 'alpha notes' });
    await repo.create({ created_by: USER_A, title: 'alpha draft' });
    await repo.create({ created_by: USER_A, title: 'beta notes' });

    const firstPage = await repo.listByUser(USER_A, 1, 1, 'alpha');
    const secondPage = await repo.listByUser(USER_A, 1, 2, 'alpha');

    expect(firstPage.totalCount).toBe(2);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.currentPage).toBe(1);
    expect(firstPage.projects).toHaveLength(1);
    expect(secondPage.currentPage).toBe(2);
    expect(secondPage.projects).toHaveLength(1);
    expect(
      [...firstPage.projects, ...secondPage.projects].map(
        (project) => project.title
      )
    ).toEqual(expect.arrayContaining(['alpha notes', 'alpha draft']));
  });

  it('should return undefined when updating a missing project', async () => {
    await expect(
      repo.update('00000000-0000-0000-0000-0000000000ff', {
        title: 'missing'
      })
    ).resolves.toBeUndefined();
  });

  it('deletes a project', async () => {
    const project = await repo.create({ created_by: USER_A });
    expect(await repo.delete(project!.id)).toBe(true);
    expect(await repo.findById(project!.id)).toBeUndefined();
  });

  it('should return false when deleting a missing project', async () => {
    await expect(
      repo.delete('00000000-0000-0000-0000-0000000000ff')
    ).resolves.toBe(false);
  });
});
