import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PunchSkillRepository } from '../PunchSkillRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';
import { randomUUID } from 'node:crypto';

describe('PunchSkillRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let repo: PunchSkillRepository;
  const userId = randomUUID();

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'punch_skill'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    repo = new PunchSkillRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  const createSkill = (overrides?: Record<string, unknown>) =>
    repo.create({
      name: 'demo-skill',
      description: 'A demo skill',
      enabled: true,
      fs_path: '/tmp/punch/demo',
      created_by: userId,
      ...overrides
    });

  it('creates and finds by id', async () => {
    const skill = await createSkill();
    const found = await repo.findById(skill.id);
    expect(found?.name).toBe('demo-skill');
    expect(found?.enabled).toBe(true);
  });

  it('lists by user and filters enabled', async () => {
    await createSkill({ name: 'a-skill' });
    await createSkill({ name: 'b-skill', enabled: false });

    const all = await repo.findByUserId(userId);
    expect(all).toHaveLength(2);

    const enabled = await repo.findEnabledByUserId(userId);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('a-skill');
  });

  it('finds by user and name', async () => {
    await createSkill({ name: 'lookup' });
    const found = await repo.findByUserIdAndName(userId, 'lookup');
    expect(found?.description).toBe('A demo skill');
  });

  it('searches by name or description', async () => {
    await createSkill({ name: 'alpha', description: 'first skill' });
    await createSkill({ name: 'beta', description: 'second skill' });
    await createSkill({ name: 'gamma', description: 'alpha related' });

    const byName = await repo.findByUserIdAndSearch(userId, 'beta');
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe('beta');

    const byDescription = await repo.findByUserIdAndSearch(userId, 'alpha');
    expect(byDescription.map((s) => s.name).sort()).toEqual(['alpha', 'gamma']);
  });

  it('paginates with search', async () => {
    for (let i = 0; i < 5; i++) {
      await createSkill({
        name: `skill-${i}`,
        description: i % 2 === 0 ? 'even item' : 'odd item'
      });
    }

    const page1 = await repo.findPaginated(userId, 2, 1, { search: 'even' });
    expect(page1.totalCount).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.skills).toHaveLength(2);
    expect(page1.currentPage).toBe(1);

    const page2 = await repo.findPaginated(userId, 2, 2, { search: 'even' });
    expect(page2.skills).toHaveLength(1);
    expect(page2.currentPage).toBe(2);
  });

  it('filters by enabled state', async () => {
    await createSkill({ name: 'on-a', enabled: true });
    await createSkill({ name: 'on-b', enabled: true });
    await createSkill({ name: 'off-a', enabled: false });

    const enabledOnly = await repo.findByUserIdFiltered(userId, {
      enabled: 'enabled'
    });
    expect(enabledOnly.map((s) => s.name).sort()).toEqual(['on-a', 'on-b']);

    const disabledOnly = await repo.findPaginated(userId, 10, 1, {
      enabled: 'disabled'
    });
    expect(disabledOnly.totalCount).toBe(1);
    expect(disabledOnly.skills[0].name).toBe('off-a');

    const searchAndFilter = await repo.findByUserIdFiltered(userId, {
      search: 'on',
      enabled: 'enabled'
    });
    expect(searchAndFilter.map((s) => s.name).sort()).toEqual(['on-a', 'on-b']);
  });

  it('updates enabled flag', async () => {
    const skill = await createSkill();
    const updated = await repo.update(skill.id, { enabled: false });
    expect(updated?.enabled).toBe(false);
  });

  it('deletes a skill', async () => {
    const skill = await createSkill();
    expect(await repo.delete(skill.id)).toBe(true);
    expect(await repo.findById(skill.id)).toBeUndefined();
  });

  it('enforces unique name per user', async () => {
    await createSkill({ name: 'unique-name' });
    await expect(createSkill({ name: 'unique-name' })).rejects.toBeDefined();
  });
});
