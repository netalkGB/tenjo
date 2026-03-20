import axios from 'axios';
import { z } from 'zod';
import { handleApiError } from '../../errors/handleApiError';
import {
  ToolApprovalRuleSchema,
  GetToolApprovalRulesResponseSchema
} from './schemas';
import type {
  ToolApprovalRule,
  GetToolApprovalRulesResponse,
  UpsertToolApprovalRuleRequest,
  BulkUpdateToolApprovalRulesRequest
} from './schemas';

export async function getToolApprovalRules(): Promise<GetToolApprovalRulesResponse> {
  try {
    const response = await axios.get('/api/settings/tool-approval-rules');
    return GetToolApprovalRulesResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function upsertToolApprovalRule(
  data: UpsertToolApprovalRuleRequest
): Promise<ToolApprovalRule> {
  try {
    const response = await axios.post(
      '/api/settings/tool-approval-rules',
      data
    );
    const validated = z
      .object({ rule: ToolApprovalRuleSchema })
      .parse(response.data);
    return validated.rule;
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteToolApprovalRule(id: string): Promise<void> {
  try {
    await axios.delete(`/api/settings/tool-approval-rules/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}

export async function bulkUpdateToolApprovalRules(
  data: BulkUpdateToolApprovalRulesRequest
): Promise<GetToolApprovalRulesResponse> {
  try {
    const response = await axios.put(
      '/api/settings/tool-approval-rules/bulk',
      data
    );
    return GetToolApprovalRulesResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}
