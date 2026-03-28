import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

type CredentialScope = 'all' | 'client' | 'tokens' | 'verifier' | 'discovery';

export interface OAuthContext {
  /** OAuth callback redirect URL (e.g. http://localhost:9876/oauth/callback) */
  redirectUrl: string;
  /** OAuth client name used for dynamic registration (defaults to 'MCP Client') */
  clientName?: string;
  /** Pre-registered OAuth Client ID (optional, skips dynamic registration) */
  clientId?: string;
  /** Pre-registered OAuth Client Secret (optional) */
  clientSecret?: string;
  /** Called when the user needs to authorize via browser */
  onRedirectToAuthorization: (authorizationUrl: URL) => void;
  /** Called when tokens are saved */
  onTokensSaved?: (tokens: OAuthTokens) => void;
  /** Called when client information is saved */
  onClientInformationSaved?: (clientInfo: OAuthClientInformationMixed) => void;
  /** Called when credentials are invalidated */
  onCredentialsInvalidated?: (scope: CredentialScope) => void;
}

export class McpOAuthClientProvider implements OAuthClientProvider {
  private _clientInfo?: OAuthClientInformationMixed;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;

  constructor(private readonly context: OAuthContext) {
    // If a clientId is provided, pre-populate client information
    if (context.clientId) {
      this._clientInfo = {
        client_id: context.clientId,
        client_secret: context.clientSecret,
      };
    }
  }

  get redirectUrl(): string {
    return this.context.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const authMethod = this.context.clientSecret
      ? 'client_secret_post'
      : 'none';
    return {
      redirect_uris: [this.context.redirectUrl],
      token_endpoint_auth_method: authMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this.context.clientName ?? 'MCP Client',
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._clientInfo;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this._clientInfo = info;
    this.context.onClientInformationSaved?.(info);
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
    this.context.onTokensSaved?.(tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.context.onRedirectToAuthorization(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    return this._codeVerifier ?? '';
  }

  invalidateCredentials(scope: CredentialScope): void {
    switch (scope) {
      case 'all':
        this._clientInfo = undefined;
        this._tokens = undefined;
        this._codeVerifier = undefined;
        break;
      case 'client':
        this._clientInfo = undefined;
        break;
      case 'tokens':
        this._tokens = undefined;
        break;
      case 'verifier':
        this._codeVerifier = undefined;
        break;
      case 'discovery':
        break;
    }
    this.context.onCredentialsInvalidated?.(scope);
  }
}
