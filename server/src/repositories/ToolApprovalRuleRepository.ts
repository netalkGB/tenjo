import { BaseRepository } from './BaseRepository';

export interface ToolApprovalRule {
  id: string;
  user_id: string;
  tool_name: string;
  auto_approve: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertToolApprovalRule {
  id?: string;
  user_id: string;
  tool_name: string;
  auto_approve?: boolean;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export type UpdateToolApprovalRule = Partial<InsertToolApprovalRule>;

const COLUMNS = [
  'id',
  'user_id',
  'tool_name',
  'auto_approve',
  'created_at',
  'updated_at'
] as const;

export class ToolApprovalRuleRepository extends BaseRepository {
  async findByUserId(userId: string): Promise<ToolApprovalRule[]> {
    const result = await this.pool.query(
      `SELECT * FROM "tool_approval_rules" WHERE "user_id" = $1`,
      [userId]
    );
    return result.rows as ToolApprovalRule[];
  }

  async findByUserIdAndToolName(
    userId: string,
    toolName: string
  ): Promise<ToolApprovalRule | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "tool_approval_rules" WHERE "user_id" = $1 AND "tool_name" = $2`,
      [userId, toolName]
    );
    return result.rows[0] as ToolApprovalRule | undefined;
  }

  async create(ruleData: InsertToolApprovalRule): Promise<ToolApprovalRule> {
    return await this.insertReturning<ToolApprovalRule>(
      'tool_approval_rules',
      { ...ruleData },
      COLUMNS
    );
  }

  async upsert(
    userId: string,
    toolName: string,
    autoApprove: boolean
  ): Promise<ToolApprovalRule> {
    const existing = await this.findByUserIdAndToolName(userId, toolName);

    if (existing) {
      const result = await this.pool.query(
        `UPDATE "tool_approval_rules" SET "auto_approve" = $1, "updated_at" = $2 WHERE "id" = $3 RETURNING *`,
        [autoApprove, new Date(), existing.id]
      );
      return result.rows[0] as ToolApprovalRule;
    }
    return await this.create({
      user_id: userId,
      tool_name: toolName,
      auto_approve: autoApprove
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "tool_approval_rules" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }

  async deleteByUserIdAndToolName(
    userId: string,
    toolName: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "tool_approval_rules" WHERE "user_id" = $1 AND "tool_name" = $2 RETURNING *`,
      [userId, toolName]
    );
    return result.rows.length > 0;
  }

  async deleteStaleRules(
    userId: string,
    activeToolNames: string[]
  ): Promise<void> {
    if (activeToolNames.length === 0) {
      await this.pool.query(
        `DELETE FROM "tool_approval_rules" WHERE "user_id" = $1`,
        [userId]
      );
    } else {
      // Build parameterized IN clause
      const placeholders = activeToolNames
        .map((_, i) => `$${i + 2}`)
        .join(', ');
      await this.pool.query(
        `DELETE FROM "tool_approval_rules" WHERE "user_id" = $1 AND "tool_name" NOT IN (${placeholders})`,
        [userId, ...activeToolNames]
      );
    }
  }

  async bulkUpsert(
    userId: string,
    toolNames: string[],
    autoApprove: boolean
  ): Promise<ToolApprovalRule[]> {
    if (toolNames.length === 0) return [];

    const results: ToolApprovalRule[] = [];
    for (const toolName of toolNames) {
      const rule = await this.upsert(userId, toolName, autoApprove);
      results.push(rule);
    }
    return results;
  }

  async bulkDeleteByToolNames(
    userId: string,
    toolNames: string[]
  ): Promise<void> {
    if (toolNames.length === 0) return;

    const placeholders = toolNames.map((_, i) => `$${i + 2}`).join(', ');
    await this.pool.query(
      `DELETE FROM "tool_approval_rules" WHERE "user_id" = $1 AND "tool_name" IN (${placeholders})`,
      [userId, ...toolNames]
    );
  }

  async shouldAutoApprove(userId: string, toolName: string): Promise<boolean> {
    const rule = await this.findByUserIdAndToolName(userId, toolName);
    return rule?.auto_approve ?? false;
  }
}
