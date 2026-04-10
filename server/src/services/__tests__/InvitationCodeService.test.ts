import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InvitationCodeService,
  InvitationCodeNotFoundError,
  InvitationCodeValidationError
} from '../InvitationCodeService';
import type { InvitationCodeRepository } from '../../repositories/InvitationCodeRepository';
import type { InvitationCode } from '../../repositories/InvitationCodeRepository';

function createMockRepo() {
  return {
    findAll: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    markUsed: vi.fn(),
    delete: vi.fn(),
    pool: vi.fn(),
    insertReturning: vi.fn()
  };
}

function buildCode(overrides: Partial<InvitationCode> = {}): InvitationCode {
  return {
    id: 'code-1',
    code: 'ABC123',
    user_role: 'admin',
    used: false,
    used_by: null,
    created_by: 'user-1',
    created_at: new Date('2025-06-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('InvitationCodeService', () => {
  let mockRepo: ReturnType<typeof createMockRepo>;
  let service: InvitationCodeService;

  beforeEach(() => {
    mockRepo = createMockRepo();
    service = new InvitationCodeService(
      mockRepo as unknown as InvitationCodeRepository
    );
  });

  describe('listAll', () => {
    it('should return all codes with formatted dates', async () => {
      const date = new Date('2025-06-01T12:00:00.000Z');
      mockRepo.findAll.mockResolvedValue([
        buildCode({ id: 'c1', code: 'AAA', created_at: date }),
        buildCode({
          id: 'c2',
          code: 'BBB',
          user_role: 'standard',
          created_at: null
        })
      ]);

      const result = await service.listAll();

      expect(result).toEqual([
        {
          id: 'c1',
          code: 'AAA',
          userRole: 'admin',
          used: false,
          createdAt: date.toISOString()
        },
        {
          id: 'c2',
          code: 'BBB',
          userRole: 'standard',
          used: false,
          createdAt: null
        }
      ]);
      expect(mockRepo.findAll).toHaveBeenCalledOnce();
    });
  });

  describe('create', () => {
    it('should create a code for admin role', async () => {
      const created = buildCode({ user_role: 'admin' });
      mockRepo.create.mockResolvedValue(created);

      const result = await service.create('admin', 'user-1');

      expect(result).toEqual({
        id: 'code-1',
        code: 'ABC123',
        userRole: 'admin',
        used: false,
        createdAt: created.created_at?.toISOString() ?? null
      });
      expect(mockRepo.create).toHaveBeenCalledWith({
        user_role: 'admin',
        created_by: 'user-1'
      });
    });

    it('should create a code for standard role', async () => {
      const created = buildCode({ user_role: 'standard' });
      mockRepo.create.mockResolvedValue(created);

      const result = await service.create('standard', 'user-1');

      expect(result.userRole).toBe('standard');
    });

    it('should return createdAt as null when created_at is null', async () => {
      const created = buildCode({ created_at: null });
      mockRepo.create.mockResolvedValue(created);

      const result = await service.create('admin', 'user-1');

      expect(result.createdAt).toBeNull();
    });

    it('should throw InvitationCodeValidationError for invalid role', async () => {
      await expect(
        service.create('invalid_role' as 'admin', 'user-1')
      ).rejects.toThrow(InvitationCodeValidationError);

      await expect(
        service.create('invalid_role' as 'admin', 'user-1')
      ).rejects.toThrow('userRole must be "admin" or "standard"');

      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete successfully when code exists', async () => {
      mockRepo.delete.mockResolvedValue(true);

      await expect(service.delete('code-1')).resolves.toBeUndefined();
      expect(mockRepo.delete).toHaveBeenCalledWith('code-1');
    });

    it('should throw InvitationCodeNotFoundError when code does not exist', async () => {
      mockRepo.delete.mockResolvedValue(false);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        InvitationCodeNotFoundError
      );
      await expect(service.delete('nonexistent')).rejects.toThrow(
        'Invitation code not found'
      );
    });
  });
});
