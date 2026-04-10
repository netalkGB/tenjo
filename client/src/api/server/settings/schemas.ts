import { z } from 'zod';

export const ProfileResponseSchema = z.object({
  fullName: z.string(),
  userName: z.string(),
  email: z.string()
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export interface UpdateProfileRequest {
  fullName?: string;
  userName?: string;
  email?: string;
}

export const UpdateProfileResponseSchema = z.object({
  success: z.boolean()
});

export interface UpdatePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const UpdatePasswordResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.string()).optional()
});

// Models

export const ModelSchema = z.object({
  id: z.string(),
  type: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  hasToken: z.boolean(),
  maxContextLength: z.number().optional()
});

export const GetModelsResponseSchema = z.object({
  activeId: z.string(),
  models: z.array(ModelSchema)
});

export type Model = z.infer<typeof ModelSchema>;
export type GetModelsResponse = z.infer<typeof GetModelsResponseSchema>;

export interface AddModelRequest {
  type: string;
  baseUrl: string;
  model: string;
  token?: string;
}

export const AvailableModelSchema = z.object({
  id: z.string(),
  ownedBy: z.string()
});

export const GetAvailableModelsResponseSchema = z.object({
  models: z.array(AvailableModelSchema)
});

export type AvailableModel = z.infer<typeof AvailableModelSchema>;
export type GetAvailableModelsResponse = z.infer<
  typeof GetAvailableModelsResponseSchema
>;

// Invitation Codes

export const UserRoleSchema = z.enum(['admin', 'standard']);

export const InvitationCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  userRole: UserRoleSchema,
  used: z.boolean(),
  createdAt: z.string().nullable()
});

export const GetInvitationCodesResponseSchema = z.object({
  codes: z.array(InvitationCodeSchema)
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type InvitationCode = z.infer<typeof InvitationCodeSchema>;
export type GetInvitationCodesResponse = z.infer<
  typeof GetInvitationCodesResponseSchema
>;

// Users

export const UserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  userName: z.string(),
  email: z.string(),
  userRole: UserRoleSchema
});

export const GetUsersResponseSchema = z.object({
  users: z.array(UserSchema)
});

export type UserItem = z.infer<typeof UserSchema>;
export type GetUsersResponse = z.infer<typeof GetUsersResponseSchema>;

// Tool Approval Rules

export const ApproveStateSchema = z.enum(['auto_approve', 'manual', 'banned']);
export type ApproveState = z.infer<typeof ApproveStateSchema>;

export const ToolApprovalRuleSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  approve: ApproveStateSchema
});

export const GetToolApprovalRulesResponseSchema = z.object({
  rules: z.array(ToolApprovalRuleSchema)
});

export type ToolApprovalRule = z.infer<typeof ToolApprovalRuleSchema>;
export type GetToolApprovalRulesResponse = z.infer<
  typeof GetToolApprovalRulesResponseSchema
>;

export interface UpsertToolApprovalRuleRequest {
  toolName: string;
  approve: ApproveState;
}

export interface BulkUpdateToolApprovalRulesRequest {
  toolNames: string[];
  approve: ApproveState;
}

// MCP Servers

export const StdioMcpServerConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional()
});

export const HttpMcpServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional()
});

export const OAuthHttpMcpServerConfigSchema = z.object({
  type: z.literal('oauth-http'),
  url: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  authorized: z.boolean().optional()
});

export type OAuthHttpMcpServerConfig = z.infer<
  typeof OAuthHttpMcpServerConfigSchema
>;

export const McpServerConfigSchema = z.discriminatedUnion('type', [
  StdioMcpServerConfigSchema,
  HttpMcpServerConfigSchema,
  OAuthHttpMcpServerConfigSchema
]);

export const McpServersConfigSchema = z.record(
  z.string(),
  McpServerConfigSchema
);

export type StdioMcpServerConfig = z.infer<typeof StdioMcpServerConfigSchema>;
export type HttpMcpServerConfig = z.infer<typeof HttpMcpServerConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpServersConfig = z.infer<typeof McpServersConfigSchema>;

export const GetMcpServersResponseSchema = z.object({
  mcpServers: McpServersConfigSchema,
  oauthCallbackUrl: z.string()
});

export type GetMcpServersResponse = z.infer<typeof GetMcpServersResponseSchema>;

export const GetMcpToolsResponseSchema = z.object({
  tools: z.record(z.string(), z.array(z.string())),
  errors: z.record(z.string(), z.string()).optional()
});

export type GetMcpToolsResponse = z.infer<typeof GetMcpToolsResponseSchema>;

export const UpdateMcpServersResponseSchema = z.object({
  success: z.boolean(),
  tools: z.record(z.string(), z.array(z.string()))
});

export type UpdateMcpServersResponse = z.infer<
  typeof UpdateMcpServersResponseSchema
>;

// User Preferences

export const UserPreferencesResponseSchema = z.object({
  language: z.string().optional(),
  theme: z.string().optional(),
  selectedKnowledgeIds: z.array(z.string()).optional(),
  disabledMcpTools: z.array(z.string()).optional()
});

export type UserPreferencesResponse = z.infer<
  typeof UserPreferencesResponseSchema
>;

export interface UpdatePreferencesRequest {
  language?: string;
  theme?: string;
  selectedKnowledgeIds?: string[];
  disabledMcpTools?: string[];
}

// Cleanup

export const CleanupStatusResponseSchema = z.object({
  cleaning: z.boolean(),
  totalSizeBytes: z.number()
});

export type CleanupStatusResponse = z.infer<typeof CleanupStatusResponseSchema>;

export const StartCleanupResponseSchema = z.object({
  success: z.boolean()
});

export type StartCleanupResponse = z.infer<typeof StartCleanupResponseSchema>;
