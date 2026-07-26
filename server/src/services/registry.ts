import {
  globalSettingRepo,
  credentialStoreRepo,
  pendingOAuthFlowRepo,
  knowledgeRepo,
  agentProjectRepo,
  userRepo,
  punchSkillRepo
} from '../repositories/registry';
import { pool } from '../db/client';
import { GlobalSettingService } from './GlobalSettingService';
import { CredentialStoreService } from './CredentialStoreService';
import { PendingOAuthFlowService } from './PendingOAuthFlowService';
import { McpOAuthService } from './McpOAuthService';
import { McpToolService } from './McpToolService';
import { FileUploadService } from './FileUploadService';
import { ImageService } from './ImageService';
import { KnowledgeService } from './KnowledgeService';
import { FileCleanupService } from './FileCleanupService';
import { AgentProjectService } from './AgentProjectService';
import { UserService } from './UserService';
import { ArtifactAccessService } from './ArtifactAccessService';
import { PunchSkillService } from './PunchSkillService';
import { agentGuiService } from './AgentGuiService';
import { agentEventBus } from '../events/AgentEventBus';
import { questionEmitter } from '../events/QuestionEmitter';
import { toolApprovalEmitter } from '../events/ToolApprovalEmitter';

export const credentialStoreService = new CredentialStoreService(
  credentialStoreRepo
);
export const fileUploadService = new FileUploadService();
export const artifactAccessService = new ArtifactAccessService(pool);
export const globalSettingService = new GlobalSettingService(
  globalSettingRepo,
  credentialStoreService,
  fileUploadService
);
export const pendingOAuthFlowService = new PendingOAuthFlowService(
  pendingOAuthFlowRepo,
  credentialStoreService
);
export const mcpOAuthService = new McpOAuthService(
  globalSettingService,
  credentialStoreService,
  pendingOAuthFlowService
);
export const mcpToolService = new McpToolService(credentialStoreService);
export const imageService = new ImageService(fileUploadService);
export const knowledgeService = new KnowledgeService(
  knowledgeRepo,
  fileUploadService
);
export const punchSkillService = new PunchSkillService(
  punchSkillRepo,
  fileUploadService
);
export const fileCleanupService = new FileCleanupService(
  pool,
  globalSettingRepo,
  punchSkillService
);
export const agentProjectService = new AgentProjectService(agentProjectRepo);
export const userService = new UserService(userRepo);

export { agentGuiService, agentEventBus, questionEmitter, toolApprovalEmitter };
