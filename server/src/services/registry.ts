import {
  globalSettingRepo,
  credentialStoreRepo,
  pendingOAuthFlowRepo
} from '../repositories/registry';
import { GlobalSettingService } from './GlobalSettingService';
import { CredentialStoreService } from './CredentialStoreService';
import { PendingOAuthFlowService } from './PendingOAuthFlowService';
import { McpOAuthService } from './McpOAuthService';

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
