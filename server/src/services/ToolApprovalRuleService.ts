import type {
  ToolApprovalRuleRepository,
  ToolApprovalRule,
  ApproveState
} from '../repositories/ToolApprovalRuleRepository';

export type { ApproveState };

export interface ToolApprovalRuleDto {
  id: string;
  toolName: string;
  approve: ApproveState;
}

function toDto(rule: ToolApprovalRule): ToolApprovalRuleDto {
  return {
    id: rule.id,
    toolName: rule.tool_name,
    approve: rule.approve
  };
}

export class ToolApprovalRuleService {
  constructor(private toolApprovalRuleRepo: ToolApprovalRuleRepository) {}

  async findByUserId(userId: string): Promise<ToolApprovalRuleDto[]> {
    const rules = await this.toolApprovalRuleRepo.findByUserId(userId);
    return rules.map(toDto);
  }

  async upsert(
    userId: string,
    toolName: string,
    approve: ApproveState
  ): Promise<ToolApprovalRuleDto> {
    const rule = await this.toolApprovalRuleRepo.upsert(
      userId,
      toolName,
      approve
    );
    return toDto(rule);
  }

  async delete(id: string): Promise<boolean> {
    return this.toolApprovalRuleRepo.delete(id);
  }

  async bulkUpdate(
    userId: string,
    toolNames: string[],
    approve: ApproveState
  ): Promise<ToolApprovalRuleDto[]> {
    if (approve === 'manual') {
      await this.toolApprovalRuleRepo.bulkDeleteByToolNames(userId, toolNames);
      return [];
    }
    const rules = await this.toolApprovalRuleRepo.bulkUpsert(
      userId,
      toolNames,
      approve
    );
    return rules.map(toDto);
  }

  async deleteStaleRules(
    userId: string,
    activeToolNames: string[]
  ): Promise<void> {
    return this.toolApprovalRuleRepo.deleteStaleRules(userId, activeToolNames);
  }
}
