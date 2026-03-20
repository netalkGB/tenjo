import type {
  ToolApprovalRuleRepository,
  ToolApprovalRule
} from '../repositories/ToolApprovalRuleRepository';

export interface ToolApprovalRuleDto {
  id: string;
  toolName: string;
  autoApprove: boolean;
}

function toDto(rule: ToolApprovalRule): ToolApprovalRuleDto {
  return {
    id: rule.id,
    toolName: rule.tool_name,
    autoApprove: rule.auto_approve
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
    autoApprove: boolean
  ): Promise<ToolApprovalRuleDto> {
    const rule = await this.toolApprovalRuleRepo.upsert(
      userId,
      toolName,
      autoApprove
    );
    return toDto(rule);
  }

  async delete(id: string): Promise<boolean> {
    return this.toolApprovalRuleRepo.delete(id);
  }

  async bulkUpdate(
    userId: string,
    toolNames: string[],
    autoApprove: boolean
  ): Promise<ToolApprovalRuleDto[]> {
    if (autoApprove) {
      const rules = await this.toolApprovalRuleRepo.bulkUpsert(
        userId,
        toolNames,
        true
      );
      return rules.map(toDto);
    } else {
      await this.toolApprovalRuleRepo.bulkDeleteByToolNames(userId, toolNames);
      return [];
    }
  }

  async deleteStaleRules(
    userId: string,
    activeToolNames: string[]
  ): Promise<void> {
    return this.toolApprovalRuleRepo.deleteStaleRules(userId, activeToolNames);
  }
}
