import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolApprovalRuleService } from '../ToolApprovalRuleService';
import type { ToolApprovalRuleRepository } from '../../repositories/ToolApprovalRuleRepository';
import type { ToolApprovalRule } from '../../repositories/ToolApprovalRuleRepository';

function createMockRepo() {
  return {
    findByUserId: vi.fn(),
    findByUserIdAndToolName: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteByUserIdAndToolName: vi.fn(),
    deleteStaleRules: vi.fn(),
    bulkUpsert: vi.fn(),
    bulkDeleteByToolNames: vi.fn(),
    shouldAutoApprove: vi.fn(),
    pool: vi.fn(),
    insertReturning: vi.fn()
  };
}

function buildRule(
  overrides: Partial<ToolApprovalRule> = {}
): ToolApprovalRule {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    tool_name: 'read_file',
    approve: 'auto_approve',
    created_at: new Date('2025-06-01T00:00:00.000Z'),
    updated_at: new Date('2025-06-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('ToolApprovalRuleService', () => {
  let mockRepo: ReturnType<typeof createMockRepo>;
  let service: ToolApprovalRuleService;

  beforeEach(() => {
    mockRepo = createMockRepo();
    service = new ToolApprovalRuleService(
      mockRepo as unknown as ToolApprovalRuleRepository
    );
  });

  describe('findByUserId', () => {
    it('should return mapped rules for a user', async () => {
      mockRepo.findByUserId.mockResolvedValue([
        buildRule({
          id: 'r1',
          tool_name: 'read_file',
          approve: 'auto_approve'
        }),
        buildRule({ id: 'r2', tool_name: 'write_file', approve: 'banned' })
      ]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([
        { id: 'r1', toolName: 'read_file', approve: 'auto_approve' },
        { id: 'r2', toolName: 'write_file', approve: 'banned' }
      ]);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no rules exist', async () => {
      mockRepo.findByUserId.mockResolvedValue([]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('should upsert a rule and return the mapped dto', async () => {
      const rule = buildRule({
        tool_name: 'exec_cmd',
        approve: 'banned'
      });
      mockRepo.upsert.mockResolvedValue(rule);

      const result = await service.upsert('user-1', 'exec_cmd', 'banned');

      expect(result).toEqual({
        id: 'rule-1',
        toolName: 'exec_cmd',
        approve: 'banned'
      });
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'user-1',
        'exec_cmd',
        'banned'
      );
    });
  });

  describe('delete', () => {
    it('should return true when rule is deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.delete('rule-1');

      expect(result).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('rule-1');
    });

    it('should return false when rule is not found', async () => {
      mockRepo.delete.mockResolvedValue(false);

      const result = await service.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('bulkUpdate', () => {
    it('should bulk upsert rules when approve is auto_approve', async () => {
      const rules = [
        buildRule({ id: 'r1', tool_name: 'tool_a', approve: 'auto_approve' }),
        buildRule({ id: 'r2', tool_name: 'tool_b', approve: 'auto_approve' })
      ];
      mockRepo.bulkUpsert.mockResolvedValue(rules);

      const result = await service.bulkUpdate(
        'user-1',
        ['tool_a', 'tool_b'],
        'auto_approve'
      );

      expect(result).toEqual([
        { id: 'r1', toolName: 'tool_a', approve: 'auto_approve' },
        { id: 'r2', toolName: 'tool_b', approve: 'auto_approve' }
      ]);
      expect(mockRepo.bulkUpsert).toHaveBeenCalledWith(
        'user-1',
        ['tool_a', 'tool_b'],
        'auto_approve'
      );
      expect(mockRepo.bulkDeleteByToolNames).not.toHaveBeenCalled();
    });

    it('should bulk upsert rules when approve is banned', async () => {
      const rules = [
        buildRule({ id: 'r1', tool_name: 'tool_a', approve: 'banned' })
      ];
      mockRepo.bulkUpsert.mockResolvedValue(rules);

      const result = await service.bulkUpdate('user-1', ['tool_a'], 'banned');

      expect(result).toEqual([
        { id: 'r1', toolName: 'tool_a', approve: 'banned' }
      ]);
      expect(mockRepo.bulkUpsert).toHaveBeenCalledWith(
        'user-1',
        ['tool_a'],
        'banned'
      );
    });

    it('should delete rules and return empty array when approve is manual', async () => {
      mockRepo.bulkDeleteByToolNames.mockResolvedValue(undefined);

      const result = await service.bulkUpdate(
        'user-1',
        ['tool_a', 'tool_b'],
        'manual'
      );

      expect(result).toEqual([]);
      expect(mockRepo.bulkDeleteByToolNames).toHaveBeenCalledWith('user-1', [
        'tool_a',
        'tool_b'
      ]);
      expect(mockRepo.bulkUpsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteStaleRules', () => {
    it('should delegate to repository with correct arguments', async () => {
      mockRepo.deleteStaleRules.mockResolvedValue(undefined);

      await service.deleteStaleRules('user-1', ['tool_a', 'tool_b']);

      expect(mockRepo.deleteStaleRules).toHaveBeenCalledWith('user-1', [
        'tool_a',
        'tool_b'
      ]);
    });
  });
});
