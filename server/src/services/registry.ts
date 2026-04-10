import {
  globalSettingRepo,
  credentialStoreRepo,
  pendingOAuthFlowRepo,
  knowledgeRepo
} from '../repositories/registry';
import { pool } from '../db/client';
import { GlobalSettingService } from './GlobalSettingService';
import { CredentialStoreService } from './CredentialStoreService';
import { PendingOAuthFlowService } from './PendingOAuthFlowService';
import { McpOAuthService } from './McpOAuthService';
import { FileUploadService } from './FileUploadService';
import { ImageService } from './ImageService';
import { KnowledgeService } from './KnowledgeService';
import { FileCleanupService } from './FileCleanupService';

export const credentialStoreService = new CredentialStoreService(
  credentialStoreRepo
);
export const globalSettingService = new GlobalSettingService(
  globalSettingRepo,
  credentialStoreService
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
export const fileUploadService = new FileUploadService();
export const imageService = new ImageService(fileUploadService);
export const knowledgeService = new KnowledgeService(
  knowledgeRepo,
  fileUploadService
);
export const fileCleanupService = new FileCleanupService(
  pool,
  globalSettingRepo
);
