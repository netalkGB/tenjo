import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ToolApprovalRuleRepository } from '../ToolApprovalRuleRepository';
import { UserRepository } from '../UserRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('ToolApprovalRuleRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let toolApprovalRuleRepository: ToolApprovalRuleRepository;
  let userRepository: UserRepository;
  let testUserId: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'tool_approval'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    toolApprovalRuleRepository = new ToolApprovalRuleRepository(pool);
    userRepository = new UserRepository(pool);
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();

    const user = await userRepository.create({
      full_name: 'Test User',
      user_name: 'testuser',
      email: 'test@example.com',
      password: 'test_password'
    });
    testUserId = user.id;
  });

  describe('create', () => {
    it('should create a new tool approval rule', async () => {
      const rule = await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'file_read',
        auto_approve: true
      });

      expect(rule).toBeDefined();
      expect(rule.id).toBeDefined();
      expect(rule.user_id).toBe(testUserId);
      expect(rule.tool_name).toBe('file_read');
      expect(rule.auto_approve).toBe(true);
    });

    it('should auto-generate unique ids', async () => {
      const rule1 = await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      const rule2 = await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_b',
        auto_approve: false
      });

      expect(rule1.id).not.toBe(rule2.id);
    });
  });

  describe('findByUserId', () => {
    it('should return empty array when no rules exist for user', async () => {
      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toEqual([]);
    });

    it('should return all rules for a user', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_b',
        auto_approve: false
      });

      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(2);
    });

    it('should only return rules for the specified user', async () => {
      const otherUser = await userRepository.create({
        full_name: 'Other User',
        user_name: 'other',
        email: 'other@example.com',
        password: 'other_password'
      });

      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: otherUser.id,
        tool_name: 'tool_b',
        auto_approve: true
      });

      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(1);
      expect(rules[0].tool_name).toBe('tool_a');
    });
  });

  describe('findByUserIdAndToolName', () => {
    it('should return undefined when no matching rule exists', async () => {
      const result = await toolApprovalRuleRepository.findByUserIdAndToolName(
        testUserId,
        'nonexistent_tool'
      );
      expect(result).toBeUndefined();
    });

    it('should return the rule when it exists', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'file_read',
        auto_approve: true
      });

      const result = await toolApprovalRuleRepository.findByUserIdAndToolName(
        testUserId,
        'file_read'
      );

      expect(result).toBeDefined();
      expect(result?.tool_name).toBe('file_read');
      expect(result?.auto_approve).toBe(true);
    });
  });

  describe('upsert', () => {
    it('should create a new rule when none exists', async () => {
      const rule = await toolApprovalRuleRepository.upsert(
        testUserId,
        'file_write',
        true
      );

      expect(rule).toBeDefined();
      expect(rule.user_id).toBe(testUserId);
      expect(rule.tool_name).toBe('file_write');
      expect(rule.auto_approve).toBe(true);
    });

    it('should update an existing rule', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'file_write',
        auto_approve: true
      });

      const updated = await toolApprovalRuleRepository.upsert(
        testUserId,
        'file_write',
        false
      );

      expect(updated.auto_approve).toBe(false);

      // Verify only one rule exists
      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should return false when rule does not exist', async () => {
      const result = await toolApprovalRuleRepository.delete(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBe(false);
    });

    it('should delete rule and return true when it exists', async () => {
      const rule = await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });

      const result = await toolApprovalRuleRepository.delete(rule.id);
      expect(result).toBe(true);

      const found = await toolApprovalRuleRepository.findByUserIdAndToolName(
        testUserId,
        'tool_a'
      );
      expect(found).toBeUndefined();
    });
  });

  describe('deleteByUserIdAndToolName', () => {
    it('should return false when no matching rule exists', async () => {
      const result = await toolApprovalRuleRepository.deleteByUserIdAndToolName(
        testUserId,
        'nonexistent_tool'
      );
      expect(result).toBe(false);
    });

    it('should delete the matching rule and return true', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_b',
        auto_approve: true
      });

      const result = await toolApprovalRuleRepository.deleteByUserIdAndToolName(
        testUserId,
        'tool_a'
      );
      expect(result).toBe(true);

      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(1);
      expect(rules[0].tool_name).toBe('tool_b');
    });
  });

  describe('deleteStaleRules', () => {
    it('should delete all rules when activeToolNames is empty', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_b',
        auto_approve: true
      });

      await toolApprovalRuleRepository.deleteStaleRules(testUserId, []);

      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(0);
    });

    it('should delete only rules not in activeToolNames', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_b',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_c',
        auto_approve: false
      });

      await toolApprovalRuleRepository.deleteStaleRules(testUserId, [
        'tool_a',
        'tool_c'
      ]);

      const rules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(rules).toHaveLength(2);
      const toolNames = rules.map((r) => r.tool_name).sort();
      expect(toolNames).toEqual(['tool_a', 'tool_c']);
    });

    it('should not affect rules of other users', async () => {
      const otherUser = await userRepository.create({
        full_name: 'Other User',
        user_name: 'other',
        email: 'other@example.com',
        password: 'other_password'
      });

      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'tool_a',
        auto_approve: true
      });
      await toolApprovalRuleRepository.create({
        user_id: otherUser.id,
        tool_name: 'tool_a',
        auto_approve: true
      });

      await toolApprovalRuleRepository.deleteStaleRules(testUserId, []);

      const myRules = await toolApprovalRuleRepository.findByUserId(testUserId);
      expect(myRules).toHaveLength(0);

      const otherRules = await toolApprovalRuleRepository.findByUserId(
        otherUser.id
      );
      expect(otherRules).toHaveLength(1);
    });
  });

  describe('shouldAutoApprove', () => {
    it('should return false when no rule exists', async () => {
      const result = await toolApprovalRuleRepository.shouldAutoApprove(
        testUserId,
        'nonexistent_tool'
      );
      expect(result).toBe(false);
    });

    it('should return true when rule has auto_approve set to true', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'file_read',
        auto_approve: true
      });

      const result = await toolApprovalRuleRepository.shouldAutoApprove(
        testUserId,
        'file_read'
      );
      expect(result).toBe(true);
    });

    it('should return false when rule has auto_approve set to false', async () => {
      await toolApprovalRuleRepository.create({
        user_id: testUserId,
        tool_name: 'file_write',
        auto_approve: false
      });

      const result = await toolApprovalRuleRepository.shouldAutoApprove(
        testUserId,
        'file_write'
      );
      expect(result).toBe(false);
    });
  });
});
