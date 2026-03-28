import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { startMcpOAuth } from '@/api/server/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import type { McpServerConfig } from '@/api/server/settings';
import { KeyValueEditor } from './key-value-editor';
import {
  recordToEntries,
  entriesToRecord,
  type KeyValueEntry
} from './key-value-utils';
import { StringListEditor } from './string-list-editor';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface McpServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, config: McpServerConfig) => void;
  /** Called when OAuth authorization completes (server config already saved by callback) */
  onOAuthComplete: () => void;
  initialName?: string;
  initialConfig?: McpServerConfig;
  /** Existing server names for duplicate detection */
  existingNames?: string[];
  /** OAuth callback URL provided by the server */
  oauthCallbackUrl?: string;
}

type TransportType = 'stdio' | 'http' | 'oauth-http';

// OAuth wizard steps
type OAuthStep = 'configure' | 'authorize';

export function McpServerDialog({
  isOpen,
  onClose,
  onSave,
  onOAuthComplete,
  initialName,
  initialConfig,
  existingNames = [],
  oauthCallbackUrl
}: McpServerDialogProps) {
  const { t } = useTranslation();
  const isEditing = !!initialName;

  const [name, setName] = useState('');
  const [transportType, setTransportType] = useState<TransportType>('stdio');

  // stdio fields
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [envEntries, setEnvEntries] = useState<KeyValueEntry[]>([]);

  // http fields
  const [url, setUrl] = useState('');
  const [headerEntries, setHeaderEntries] = useState<KeyValueEntry[]>([]);

  // oauth-http fields
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // OAuth wizard state
  const [oauthStep, setOauthStep] = useState<OAuthStep>('configure');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthAuthorized, setOauthAuthorized] = useState(false);
  const [oauthError, setOauthError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      if (initialConfig) {
        setTransportType(initialConfig.type);
        setName(initialName ?? '');

        if (initialConfig.type === 'stdio') {
          setCommand(initialConfig.command);
          setArgs(initialConfig.args ?? []);
          setEnvEntries(recordToEntries(initialConfig.env));
          setUrl('');
          setHeaderEntries([]);
          setClientId('');
          setClientSecret('');
        } else if (initialConfig.type === 'http') {
          setUrl(initialConfig.url);
          setHeaderEntries(recordToEntries(initialConfig.headers));
          setCommand('');
          setArgs([]);
          setEnvEntries([]);
          setClientId('');
          setClientSecret('');
        } else {
          // oauth-http
          setUrl(initialConfig.url);
          setClientId(initialConfig.clientId ?? '');
          setClientSecret(initialConfig.clientSecret ?? '');
          setAdvancedOpen(
            !!(initialConfig.clientId || initialConfig.clientSecret)
          );
          setOauthAuthorized(!!initialConfig.authorized);
          setCommand('');
          setArgs([]);
          setEnvEntries([]);
          setHeaderEntries([]);
        }
      } else {
        resetForm();
      }
    }
  }, [isOpen, initialName, initialConfig]);

  // Listen for OAuth popup callback messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'mcp-oauth-success') {
        setOauthLoading(false);
        setOauthAuthorized(true);
        setOauthError(undefined);
      } else if (event.data?.type === 'mcp-oauth-error') {
        setOauthLoading(false);
        setOauthError(
          String(event.data.error || t('settings_mcp_oauth_error'))
        );
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [t]);

  const resetForm = () => {
    setName('');
    setTransportType('stdio');
    setCommand('');
    setArgs([]);
    setEnvEntries([]);
    setUrl('');
    setHeaderEntries([]);
    setClientId('');
    setClientSecret('');
    setAdvancedOpen(false);
    setOauthStep('configure');
    setOauthLoading(false);
    setOauthAuthorized(false);
    setOauthError(undefined);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // OAuth wizard: move to authorize step and open popup
  const handleOAuthNext = async () => {
    setOauthStep('authorize');
    setOauthLoading(true);
    setOauthError(undefined);

    try {
      const response = await startMcpOAuth({
        serverName: name.trim(),
        url: url.trim(),
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined
      });

      window.open(
        response.authorizationUrl,
        'mcp-oauth',
        'width=600,height=700,menubar=no,toolbar=no'
      );
    } catch (error) {
      setOauthLoading(false);
      setOauthError(
        error instanceof Error ? error.message : t('settings_mcp_oauth_error')
      );
    }
  };

  // OAuth wizard: done — config was already saved by the callback
  const handleOAuthDone = () => {
    resetForm();
    onOAuthComplete();
  };

  // Non-OAuth save
  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (transportType === 'stdio') {
      if (!command.trim()) return;
      onSave(trimmedName, {
        type: 'stdio',
        command: command.trim(),
        args: args.filter(a => a.trim() !== ''),
        env: entriesToRecord(envEntries)
      });
    } else if (transportType === 'http') {
      if (!url.trim()) return;
      onSave(trimmedName, {
        type: 'http',
        url: url.trim(),
        headers: entriesToRecord(headerEntries)
      });
    }

    resetForm();
  };

  // When editing, the current name is allowed (not a duplicate)
  const isDuplicateName =
    !isEditing &&
    existingNames.some(n => n.toLowerCase() === name.trim().toLowerCase());

  const isConfigValid =
    name.trim() !== '' &&
    !isDuplicateName &&
    (transportType === 'stdio' ? command.trim() !== '' : url.trim() !== '');

  // Render OAuth authorize step (step 2)
  if (transportType === 'oauth-http' && oauthStep === 'authorize') {
    return (
      <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings_mcp_oauth_authorize_title')}</DialogTitle>
            <DialogDescription>
              {oauthAuthorized
                ? t('settings_mcp_oauth_authorize_done_description')
                : t('settings_mcp_oauth_authorize_description')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-6">
            {oauthLoading && !oauthAuthorized && (
              <>
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('settings_mcp_oauth_waiting')}
                </p>
              </>
            )}

            {oauthAuthorized && (
              <>
                <CheckCircle2 className="size-8 text-green-500" />
                <p className="text-sm font-medium">
                  {t('settings_mcp_oauth_authorized')}
                </p>
              </>
            )}

            {oauthError && (
              <div className="space-y-3 text-center">
                <p className="text-sm text-destructive">{oauthError}</p>
                <Button variant="outline" size="sm" onClick={handleOAuthNext}>
                  <ExternalLink className="size-4 mr-1" />
                  {t('settings_mcp_oauth_retry')}
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOauthStep('configure');
                setOauthLoading(false);
                setOauthError(undefined);
              }}
              disabled={oauthLoading}
            >
              {t('back')}
            </Button>
            <Button onClick={handleOAuthDone} disabled={!oauthAuthorized}>
              {t('done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Render configure step (step 1 / all types)
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t('settings_mcp_edit_server')
              : t('settings_mcp_add_server')}
          </DialogTitle>
          {transportType === 'oauth-http' && (
            <DialogDescription>
              {t('settings_mcp_oauth_description')}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('settings_mcp_server_name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isEditing}
            />
            {isDuplicateName && (
              <p className="text-sm text-destructive">
                {t('settings_mcp_server_name_duplicate')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('settings_mcp_transport_type')}</Label>
            <Select
              value={transportType}
              onValueChange={value => setTransportType(value as TransportType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">
                  {t('settings_mcp_transport_stdio')}
                </SelectItem>
                <SelectItem value="http">
                  {t('settings_mcp_transport_http')}
                </SelectItem>
                <SelectItem value="oauth-http">
                  {t('settings_mcp_transport_oauth_http')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {transportType === 'stdio' && (
            <>
              <div className="space-y-2">
                <Label>{t('settings_mcp_command')}</Label>
                <Input
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_args')}</Label>
                <StringListEditor items={args} onChange={setArgs} />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_env')}</Label>
                <KeyValueEditor entries={envEntries} onChange={setEnvEntries} />
              </div>
            </>
          )}

          {transportType === 'http' && (
            <>
              <div className="space-y-2">
                <Label>{t('settings_mcp_url')}</Label>
                <Input
                  placeholder={t('settings_mcp_url_placeholder')}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_headers')}</Label>
                <KeyValueEditor
                  entries={headerEntries}
                  onChange={setHeaderEntries}
                  keyPlaceholder={t('settings_mcp_header_key_placeholder')}
                  valuePlaceholder={t('settings_mcp_header_value_placeholder')}
                />
              </div>
            </>
          )}

          {transportType === 'oauth-http' && (
            <>
              <div className="space-y-2">
                <Label>{t('settings_mcp_oauth_remote_url')}</Label>
                <Input
                  placeholder={t('settings_mcp_url_placeholder')}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {advancedOpen ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  {t('settings_mcp_oauth_advanced')}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {t('settings_mcp_oauth_advanced_hint_open')}
                    </p>
                    <code className="block rounded bg-muted px-3 py-2 text-sm select-all">
                      {oauthCallbackUrl}
                    </code>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('settings_mcp_oauth_client_id')}</Label>
                    <Input
                      placeholder={t(
                        'settings_mcp_oauth_client_id_placeholder'
                      )}
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t('settings_mcp_oauth_client_secret')}</Label>
                    <Input
                      type="password"
                      placeholder={t(
                        'settings_mcp_oauth_client_secret_placeholder'
                      )}
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('cancel')}
          </Button>
          {transportType === 'oauth-http' ? (
            <Button onClick={handleOAuthNext} disabled={!isConfigValid}>
              {t('next')}
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={!isConfigValid}>
              {isEditing ? t('save') : t('settings_mcp_add_server')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
