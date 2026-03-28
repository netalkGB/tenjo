import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';
import {
  type ErrorResponse,
  type SessionUser,
  type UserRole,
  typedHandler
} from '../../types/api';
import type {
  ModelEntry,
  ModelEntryResponse
} from '../../repositories/GlobalSettingRepository';
import type { McpServersConfig } from 'tenjo-chat-engine';
import { McpToolService } from '../../services/McpToolService';
import {
  UserService,
  UserNotFoundError,
  UserValidationError,
  UserDuplicateError,
  type ProfileInfo
} from '../../services/UserService';
import {
  InvitationCodeService,
  InvitationCodeNotFoundError,
  InvitationCodeValidationError,
  type InvitationCodeInfo
} from '../../services/InvitationCodeService';
import { ToolApprovalRuleService } from '../../services/ToolApprovalRuleService';
import {
  userRepo,
  toolApprovalRuleRepo,
  invitationCodeRepo
} from '../../repositories/registry';
import {
  globalSettingService,
  credentialStoreService,
  mcpOAuthService
} from '../../services/registry';
import {
  ModelNotFoundError,
  ModelDuplicateError
} from '../../services/GlobalSettingService';
import {
  McpOAuthError,
  McpOAuthStateNotFoundError
} from '../../services/McpOAuthService';
import { HttpError } from '../../errors/HttpError';
import { OpenAIChatApiClient, LocalChatApiClient } from 'tenjo-chat-engine';
import { createChatApiClient } from '../../factories/chatClientFactory';
import { getOAuthRedirectUrl } from '../../utils/env';
import logger from '../../logger';

export const settingsRouter = express.Router();

const mcpToolService = new McpToolService(credentialStoreService);
const userService = new UserService(userRepo);
const invitationCodeService = new InvitationCodeService(invitationCodeRepo);
const toolApprovalRuleService = new ToolApprovalRuleService(
  toolApprovalRuleRepo
);

/*
 * GET /api/settings/models
 * Retrieves the list of global model settings (tokens excluded).
 * activeId is obtained from per-user settings.
 */
interface GetModelsResponse {
  activeId: string;
  models: ModelEntryResponse[];
}

settingsRouter.get(
  '/models',
  requireCsrfToken,
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<GetModelsResponse | ErrorResponse>
  ) => {
    const sessionUser = req.user as SessionUser;

    const clientData = await globalSettingService.getModelSettingsForClient();

    // Get per-user activeModelId
    const userActiveModelId = await userService.getActiveModelId(
      sessionUser.id
    );
    const activeId = userActiveModelId ?? clientData.activeId;

    res.json({ activeId, models: clientData.models });
  }
);

/*
 * GET /api/settings/models/available
 * Fetches the list of available models from an OpenAI-compatible server.
 */
interface GetAvailableModelsRequest {
  query: { baseUrl: string; token?: string };
}

interface AvailableModel {
  id: string;
  ownedBy: string;
}

interface GetAvailableModelsResponse {
  models: AvailableModel[];
}

settingsRouter.get(
  '/models/available',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<
    GetAvailableModelsRequest,
    GetAvailableModelsResponse | ErrorResponse
  >(async (req, res) => {
    const baseUrl = req.query.baseUrl as string | undefined;
    if (!baseUrl) {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        'baseUrl query parameter is required'
      );
    }

    const token = (req.query.token as string | undefined) || null;

    try {
      const models = await OpenAIChatApiClient.listModels(baseUrl, token);
      const sorted = models.sort((a, b) => a.id.localeCompare(b.id));
      res.json({
        models: sorted.map((m) => ({ id: m.id, ownedBy: m.owned_by }))
      });
    } catch (error) {
      logger.warn('Failed to fetch models from server', {
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new HttpError(
        StatusCodes.BAD_GATEWAY,
        'Failed to fetch models from the server'
      );
    }
  })
);

/*
 * POST /api/settings/models
 * Adds a new model setting (admin only).
 */
interface AddModelRequest {
  body: {
    type: string;
    baseUrl: string;
    model: string;
    token?: string;
  };
}

interface AddModelResponse {
  model: ModelEntryResponse;
}

settingsRouter.post(
  '/models',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<AddModelRequest, AddModelResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { type, baseUrl, model, token } = req.body;

        if (!type || !baseUrl || !model) {
          throw new HttpError(
            StatusCodes.BAD_REQUEST,
            'type, baseUrl, and model are required'
          );
        }

        const maxContextLength = await fetchMaxContextLength(
          type as ModelEntry['type'],
          baseUrl,
          model,
          token || null
        );

        const newEntry = await globalSettingService.addModel(
          {
            type: type as ModelEntry['type'],
            baseUrl,
            model,
            token: token || undefined,
            maxContextLength: maxContextLength ?? undefined
          },
          sessionUser.id
        );

        res.json({ model: newEntry });
      } catch (err) {
        if (err instanceof ModelDuplicateError) {
          throw new HttpError(StatusCodes.CONFLICT, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * DELETE /api/settings/models/:id
 * Deletes a model setting (admin only).
 */
interface DeleteModelRequest {
  params: { id: string };
}

interface DeleteModelResponse {
  success: boolean;
}

settingsRouter.delete(
  '/models/:id',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<DeleteModelRequest, DeleteModelResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { id } = req.params;

        await globalSettingService.deleteModel(id, sessionUser.id);
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ModelNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * GET /api/settings/tool-approval-rules
 * Retrieves the list of tool auto-approval rules.
 */
interface ToolApprovalRule {
  id: string;
  toolName: string;
  approve: string;
}

interface GetToolApprovalRulesResponse {
  rules: ToolApprovalRule[];
}

settingsRouter.get(
  '/tool-approval-rules',
  requireCsrfToken,
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<GetToolApprovalRulesResponse | ErrorResponse>
  ) => {
    const sessionUser = req.user as SessionUser;

    const rules = await toolApprovalRuleService.findByUserId(sessionUser.id);

    res.json({ rules });
  }
);

/*
 * POST /api/settings/tool-approval-rules
 * Adds or updates a tool auto-approval rule.
 */
interface UpsertToolApprovalRuleRequest {
  body: {
    toolName: string;
    approve: string;
  };
}

interface UpsertToolApprovalRuleResponse {
  rule: ToolApprovalRule;
}

settingsRouter.post(
  '/tool-approval-rules',
  requireCsrfToken,
  requireAuth,
  typedHandler<
    UpsertToolApprovalRuleRequest,
    UpsertToolApprovalRuleResponse | ErrorResponse
  >(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { toolName, approve } = req.body;

    const validApproveValues = ['auto_approve', 'manual', 'banned'];
    if (!toolName || !validApproveValues.includes(approve)) {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        'toolName and approve (auto_approve | manual | banned) are required'
      );
    }

    const rule = await toolApprovalRuleService.upsert(
      sessionUser.id,
      toolName,
      approve as 'auto_approve' | 'manual' | 'banned'
    );

    res.json({ rule });
  })
);

/*
 * DELETE /api/settings/tool-approval-rules/:id
 * Deletes a tool auto-approval rule.
 */
interface DeleteToolApprovalRuleRequest {
  params: { id: string };
}

interface DeleteToolApprovalRuleResponse {
  success: boolean;
}

settingsRouter.delete(
  '/tool-approval-rules/:id',
  requireCsrfToken,
  requireAuth,
  typedHandler<
    DeleteToolApprovalRuleRequest,
    DeleteToolApprovalRuleResponse | ErrorResponse
  >(async (req, res) => {
    const { id } = req.params;

    const deleted = await toolApprovalRuleService.delete(id);

    if (!deleted) {
      throw new HttpError(
        StatusCodes.NOT_FOUND,
        'Tool approval rule not found'
      );
    }

    res.json({ success: true });
  })
);

/*
 * PUT /api/settings/tool-approval-rules/bulk
 * Bulk update tool auto-approval rules.
 */
interface BulkUpdateToolApprovalRulesRequest {
  body: {
    toolNames: string[];
    approve: string;
  };
}

interface BulkUpdateToolApprovalRulesResponse {
  rules: ToolApprovalRule[];
}

settingsRouter.put(
  '/tool-approval-rules/bulk',
  requireCsrfToken,
  requireAuth,
  typedHandler<
    BulkUpdateToolApprovalRulesRequest,
    BulkUpdateToolApprovalRulesResponse | ErrorResponse
  >(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { toolNames, approve } = req.body;

    const validApproveValues = ['auto_approve', 'manual', 'banned'];
    if (!Array.isArray(toolNames) || !validApproveValues.includes(approve)) {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        'toolNames (array) and approve (auto_approve | manual | banned) are required'
      );
    }

    await toolApprovalRuleService.bulkUpdate(
      sessionUser.id,
      toolNames,
      approve as 'auto_approve' | 'manual' | 'banned'
    );

    const rules = await toolApprovalRuleService.findByUserId(sessionUser.id);
    res.json({ rules });
  })
);

/*
 * PATCH /api/settings/models/active
 * Sets the active model ID (per-user).
 */
interface SetActiveModelRequest {
  body: { activeId: string };
}

interface SetActiveModelResponse {
  success: boolean;
}

settingsRouter.patch(
  '/models/active',
  requireCsrfToken,
  requireAuth,
  typedHandler<SetActiveModelRequest, SetActiveModelResponse | ErrorResponse>(
    async (req, res) => {
      const sessionUser = req.user as SessionUser;
      const { activeId } = req.body;

      await userService.setActiveModel(sessionUser.id, activeId);
      res.json({ success: true });
    }
  )
);

/*
 * GET /api/settings/mcp-servers
 * Returns the global MCP server settings as structured data.
 */
interface GetMcpServersResponse {
  mcpServers: McpServersConfig;
  oauthCallbackUrl: string;
}

settingsRouter.get(
  '/mcp-servers',
  requireCsrfToken,
  requireAuth,
  async (
    _req: express.Request,
    res: express.Response<GetMcpServersResponse | ErrorResponse>
  ) => {
    const mcpServers = await globalSettingService.getMcpServersConfig();

    // Sanitize oauth-http configs before sending to the client:
    // - Strip credentialId (internal DB reference) and clientSecret (sensitive)
    // - Inject `authorized` flag so the client can display status
    for (const config of Object.values(mcpServers)) {
      if (config.type === 'oauth-http') {
        const raw = config as unknown as Record<string, unknown>;
        const credentialId = raw.credentialId as string | undefined;
        raw.authorized = credentialId
          ? await credentialStoreService.exists(credentialId)
          : false;
        delete raw.credentialId;
        delete raw.clientSecret;
      }
    }

    const oauthCallbackUrl = getOAuthRedirectUrl();
    res.json({ mcpServers, oauthCallbackUrl });
  }
);

/*
 * GET /api/settings/mcp-tools
 * Retrieves the list of available tools from the global MCP settings.
 */
interface GetMcpToolsResponse {
  tools: Record<string, string[]>;
  errors: Record<string, string>;
}

settingsRouter.get(
  '/mcp-tools',
  requireCsrfToken,
  requireAuth,
  async (
    _req: express.Request,
    res: express.Response<GetMcpToolsResponse | ErrorResponse>
  ) => {
    const mcpServers = await globalSettingService.getMcpServersConfig();

    const { tools, errors } =
      await mcpToolService.validateAndGetToolsByServer(mcpServers);

    if (Object.keys(errors).length > 0) {
      logger.warn('Some MCP servers failed to connect:', errors);
    }

    res.json({ tools, errors });
  }
);

/*
 * PUT /api/settings/mcp-servers
 * Updates the global MCP server settings (admin only).
 * Returns the list of available tools after saving.
 */
interface UpdateMcpServersRequest {
  body: { mcpServers: McpServersConfig };
}

interface UpdateMcpServersResponse {
  success: boolean;
  tools: Record<string, string[]>;
}

settingsRouter.put(
  '/mcp-servers',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<
    UpdateMcpServersRequest,
    UpdateMcpServersResponse | ErrorResponse
  >(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { mcpServers } = req.body;

    validateMcpServersConfig(mcpServers);

    // Restore server-side fields (credentialId) that are stripped from
    // the GET response for security. Without this, saving a new server
    // would erase credentialId from existing OAuth servers.
    const existingServers = await globalSettingService.getMcpServersConfig();
    for (const [name, config] of Object.entries(mcpServers)) {
      if (config.type === 'oauth-http') {
        const existing = existingServers[name] as unknown as
          | (Record<string, unknown> & { type: string })
          | undefined;
        if (existing?.type === 'oauth-http' && existing.credentialId) {
          (config as unknown as Record<string, unknown>).credentialId =
            existing.credentialId;
        }
      }
    }

    // Validate connectivity BEFORE saving to DB
    const { tools, errors } =
      await mcpToolService.validateAndGetToolsByServer(mcpServers);

    const failedServers = Object.entries(errors);
    if (failedServers.length > 0) {
      const details = failedServers
        .map(([name, msg]) => `${name}: ${msg}`)
        .join('\n');
      throw new HttpError(StatusCodes.BAD_REQUEST, details);
    }

    await globalSettingService.updateMcpServersConfig(
      mcpServers,
      sessionUser.id
    );

    // Delete auto-approval rules for non-existent tools across all users
    const allToolNames = Object.values(tools).flat();
    await toolApprovalRuleService.deleteStaleRules(
      sessionUser.id,
      allToolNames
    );

    res.json({ success: true, tools });
  })
);

async function fetchMaxContextLength(
  type: ModelEntry['type'],
  baseUrl: string,
  model: string,
  token: string | null
): Promise<number | null> {
  try {
    const client = createChatApiClient({ type, baseUrl, model, token }, []);
    if (client instanceof LocalChatApiClient) {
      return await client.getMaxContextLength();
    }
    return null;
  } catch (error) {
    logger.warn('Failed to fetch max context length', {
      type,
      baseUrl,
      model,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function validateMcpServersConfig(mcpServers: McpServersConfig): void {
  if (
    typeof mcpServers !== 'object' ||
    mcpServers === null ||
    Array.isArray(mcpServers)
  ) {
    throw new HttpError(
      StatusCodes.BAD_REQUEST,
      'mcpServers must be an object'
    );
  }

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== 'object') {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        `Server "${name}" config must be an object`
      );
    }

    const serverType = config.type || 'stdio';

    if (serverType === 'http') {
      if (!('url' in config) || !config.url || typeof config.url !== 'string') {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          `Server "${name}" (http) must have a url property`
        );
      }
    } else if (serverType === 'oauth-http') {
      if (!('url' in config) || !config.url || typeof config.url !== 'string') {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          `Server "${name}" (oauth-http) must have a url property`
        );
      }
    } else {
      if (
        !('command' in config) ||
        !config.command ||
        typeof config.command !== 'string'
      ) {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          `Server "${name}" (stdio) must have a command property`
        );
      }
    }
  }
}

/*
 * GET /api/settings/users
 * Retrieves the user list (admin only).
 */
interface ApiUser {
  id: string;
  fullName: string;
  userName: string;
  email: string;
  userRole: UserRole;
}

interface GetUsersResponse {
  users: ApiUser[];
}

settingsRouter.get(
  '/users',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  async (
    _req: express.Request,
    res: express.Response<GetUsersResponse | ErrorResponse>
  ) => {
    const users = await userService.listAll();

    res.json({ users });
  }
);

/*
 * DELETE /api/settings/users/:id
 * Deletes a user (admin only, cannot delete yourself).
 */
interface DeleteUserRequest {
  params: { id: string };
}

interface DeleteUserResponse {
  success: boolean;
}

settingsRouter.delete(
  '/users/:id',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<DeleteUserRequest, DeleteUserResponse | ErrorResponse>(
    async (req, res) => {
      const sessionUser = req.user as SessionUser;
      const { id } = req.params;

      if (sessionUser.id === id) {
        throw new HttpError(StatusCodes.BAD_REQUEST, 'Cannot delete yourself');
      }

      const deleted = await userService.deleteUser(id);

      if (!deleted) {
        throw new HttpError(StatusCodes.NOT_FOUND, 'User not found');
      }

      res.json({ success: true });
    }
  )
);

/*
 * GET /api/settings/invitation-codes
 * Retrieves the invitation code list (admin only).
 */
interface GetInvitationCodesResponse {
  codes: InvitationCodeInfo[];
}

settingsRouter.get(
  '/invitation-codes',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  async (
    _req: express.Request,
    res: express.Response<GetInvitationCodesResponse | ErrorResponse>
  ) => {
    const codes = await invitationCodeService.listAll();
    res.json({ codes });
  }
);

/*
 * POST /api/settings/invitation-codes
 * Generates an invitation code (admin only).
 */
interface CreateInvitationCodeRequest {
  body: { userRole: UserRole };
}

interface CreateInvitationCodeResponse {
  code: InvitationCodeInfo;
}

settingsRouter.post(
  '/invitation-codes',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<
    CreateInvitationCodeRequest,
    CreateInvitationCodeResponse | ErrorResponse
  >(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { userRole } = req.body;

      const code = await invitationCodeService.create(userRole, sessionUser.id);
      res.json({ code });
    } catch (err) {
      if (err instanceof InvitationCodeValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  })
);

/*
 * DELETE /api/settings/invitation-codes/:id
 * Deletes an invitation code (admin only).
 */
interface DeleteInvitationCodeRequest {
  params: { id: string };
}

interface DeleteInvitationCodeResponse {
  success: boolean;
}

settingsRouter.delete(
  '/invitation-codes/:id',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  typedHandler<
    DeleteInvitationCodeRequest,
    DeleteInvitationCodeResponse | ErrorResponse
  >(async (req, res) => {
    try {
      const { id } = req.params;
      await invitationCodeService.delete(id);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof InvitationCodeNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      throw err;
    }
  })
);

/*
 * GET /api/settings/profile
 * Retrieves the logged-in user's profile information.
 */
settingsRouter.get(
  '/profile',
  requireCsrfToken,
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<ProfileInfo | ErrorResponse>
  ) => {
    try {
      const sessionUser = req.user as SessionUser;
      const profile = await userService.getProfile(sessionUser.id);
      res.json(profile);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      throw err;
    }
  }
);

/*
 * PATCH /api/settings/profile
 * Updates the logged-in user's profile information (no password required).
 */
interface UpdateProfileRequest {
  body: {
    fullName?: string;
    userName?: string;
    email?: string;
  };
}

interface UpdateProfileResponse {
  success: boolean;
}

settingsRouter.patch(
  '/profile',
  requireCsrfToken,
  requireAuth,
  typedHandler<UpdateProfileRequest, UpdateProfileResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { fullName, userName, email } = req.body;

        const result = await userService.updateProfile(sessionUser.id, {
          fullName,
          userName,
          email
        });

        // Update session information
        if (result.userName && req.session.user) {
          req.session.user.userName = result.userName;
          req.user = req.session.user;
        }

        res.json({ success: true });
      } catch (err) {
        if (err instanceof UserValidationError) {
          throw new HttpError(StatusCodes.BAD_REQUEST, err.message, err.errors);
        }
        if (err instanceof UserDuplicateError) {
          throw new HttpError(StatusCodes.CONFLICT, err.message);
        }
        if (err instanceof UserNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * PATCH /api/settings/profile/password
 * Updates the logged-in user's password (current password required).
 */
interface ChangePasswordRequest {
  body: {
    currentPassword: string;
    newPassword: string;
  };
}

interface ChangePasswordResponse {
  success: boolean;
}

settingsRouter.patch(
  '/profile/password',
  requireCsrfToken,
  requireAuth,
  typedHandler<ChangePasswordRequest, ChangePasswordResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { currentPassword, newPassword } = req.body;

        await userService.changePassword(
          sessionUser.id,
          currentPassword,
          newPassword
        );
        res.json({ success: true });
      } catch (err) {
        if (err instanceof UserValidationError) {
          throw new HttpError(StatusCodes.BAD_REQUEST, err.message, err.errors);
        }
        if (err instanceof UserNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * GET /api/settings/preferences
 * Returns the user's language and theme preferences.
 */
interface GetPreferencesResponse {
  language?: string;
  theme?: string;
}

settingsRouter.get(
  '/preferences',
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<GetPreferencesResponse | ErrorResponse>
  ) => {
    const sessionUser = req.user as SessionUser;
    const prefs = await userService.getUserPreferences(sessionUser.id);
    res.json(prefs);
  }
);

/*
 * PATCH /api/settings/preferences
 * Updates the user's language and theme preferences.
 */
interface UpdatePreferencesRequest {
  body: { language?: string; theme?: string };
}

interface UpdatePreferencesResponse {
  success: boolean;
}

settingsRouter.patch(
  '/preferences',
  requireCsrfToken,
  requireAuth,
  typedHandler<
    UpdatePreferencesRequest,
    UpdatePreferencesResponse | ErrorResponse
  >(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { language, theme } = req.body;
    await userService.updateUserPreferences(sessionUser.id, {
      language,
      theme
    });
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// OAuth MCP Server Authentication Flow
// ---------------------------------------------------------------------------

const oauthAuthorizeSchema = z.object({
  serverName: z.string().min(1),
  url: z.string().min(1),
  clientId: z.string().optional(),
  clientSecret: z.string().optional()
});

/*
 * POST /api/settings/mcp-oauth/authorize
 * Initiates the OAuth flow for an MCP server (admin only).
 * Returns an authorization URL that the frontend should open in a popup.
 */
settingsRouter.post(
  '/mcp-oauth/authorize',
  requireCsrfToken,
  requireAuth,
  requireAdmin,
  async (req: express.Request, res: express.Response) => {
    const parseResult = oauthAuthorizeSchema.safeParse(req.body);
    if (!parseResult.success) {
      const messages = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      res.status(StatusCodes.BAD_REQUEST).json({ message: messages });
      return;
    }

    const sessionUser = req.user as SessionUser;

    try {
      const result = await mcpOAuthService.authorize(
        parseResult.data,
        sessionUser.id
      );
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof McpOAuthError) {
        res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .json({ message: error.message });
        return;
      }
      throw error;
    }
  }
);

/*
 * GET /api/settings/mcp-oauth/callback
 * OAuth redirect callback — called by the OAuth provider, not by the frontend.
 * No CSRF / auth middleware since this is an external redirect.
 */
settingsRouter.get(
  '/mcp-oauth/callback',
  async (req: express.Request, res: express.Response) => {
    const { code, state: stateId } = req.query;

    if (
      !code ||
      !stateId ||
      typeof code !== 'string' ||
      typeof stateId !== 'string'
    ) {
      res
        .status(StatusCodes.BAD_REQUEST)
        .send('Missing code or state parameter');
      return;
    }

    try {
      const result = await mcpOAuthService.handleCallback({
        code,
        state: stateId
      });
      res.render('oauth-callback', {
        success: true,
        serverName: result.serverName
      });
    } catch (error: unknown) {
      if (error instanceof McpOAuthStateNotFoundError) {
        res.status(StatusCodes.BAD_REQUEST).send(error.message);
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).render('oauth-callback', {
        success: false,
        errorMessage: message
      });
    }
  }
);
