import { useTranslation } from '@/hooks/useTranslation';
import { useState, useEffect, useRef } from 'react';
import {
  getToolApprovalRules,
  deleteToolApprovalRule,
  getMcpServers,
  getMcpTools,
  updateMcpServers,
  upsertToolApprovalRule,
  bulkUpdateToolApprovalRules,
  type ToolApprovalRule,
  type McpServersConfig,
  type McpServerConfig
} from '@/api/server/settings';
import { ApiError } from '@/api/errors/ApiError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, Plus, Pencil, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useDialog } from '@/hooks/useDialog';
import { useUser } from '@/hooks/useUser';
import { useSettings } from '@/contexts/settings-context';
import { McpServerDialog } from '@/components/settings/mcp-server-dialog';

function McpServerListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map(i => (
        <div
          key={i}
          className="flex items-center justify-between border rounded-lg p-4"
        >
          <div className="space-y-2 min-w-0 flex-1">
            <Skeleton className="h-5 w-32" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-12 rounded-md" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <div className="flex gap-1 ml-2">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolApprovalRulesSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="flex items-center justify-between border rounded-md p-3"
        >
          <Skeleton className="h-4 w-44" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function getMcpServerSummary(config: McpServerConfig): string {
  if (config.type === 'http') {
    return config.url;
  }
  const parts = [config.command, ...(config.args ?? [])];
  return parts.join(' ');
}

export function ToolsMcpSettings() {
  const { t } = useTranslation();
  const { openDialog, closeDialog } = useDialog();
  const { userRole, singleUserMode } = useUser();
  const { reloadTools } = useSettings();

  const [toolApprovalRules, setToolApprovalRules] = useState<
    ToolApprovalRule[]
  >([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServersConfig>({});
  const [mcpServersLoaded, setMcpServersLoaded] = useState(false);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<
    Record<string, string[]>
  >({});
  const [mcpToolsLoaded, setMcpToolsLoaded] = useState(false);

  const [isMcpDialogOpen, setIsMcpDialogOpen] = useState(false);
  const [editingServerName, setEditingServerName] = useState<
    string | undefined
  >(undefined);
  const [editingServerConfig, setEditingServerConfig] = useState<
    McpServerConfig | undefined
  >(undefined);

  const isAdmin = userRole === 'admin';

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadToolApprovalRules();
    loadMcpServers();
    loadMcpTools();
  });

  const loadToolApprovalRules = async () => {
    try {
      const response = await getToolApprovalRules();
      setToolApprovalRules(response.rules);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_tool_rules'),
        type: 'ok'
      });
    } finally {
      setRulesLoaded(true);
    }
  };

  const loadMcpServers = async () => {
    try {
      const response = await getMcpServers();
      setMcpServers(response.mcpServers);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_mcp_servers'),
        type: 'ok'
      });
    } finally {
      setMcpServersLoaded(true);
    }
  };

  const loadMcpTools = async () => {
    try {
      const response = await getMcpTools();
      setMcpToolsByServer(response.tools);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_mcp_tools'),
        type: 'ok'
      });
    } finally {
      setMcpToolsLoaded(true);
    }
  };

  const handleSaveMcpServer = async (name: string, config: McpServerConfig) => {
    const prev = { ...mcpServers };
    const next = { ...mcpServers, [name]: config };
    setMcpServers(next);
    setIsMcpDialogOpen(false);
    setEditingServerName(undefined);
    setEditingServerConfig(undefined);
    setRulesLoaded(false);
    try {
      const response = await updateMcpServers(next);
      setMcpToolsByServer(response.tools);
      await reloadTools();
    } catch (error) {
      setMcpServers(prev);
      const detail =
        error instanceof ApiError && error.message ? error.message : '';
      openDialog({
        title: t('error'),
        description: detail
          ? `${t('error_save_mcp_server')}\n${detail}`
          : t('error_save_mcp_server'),
        type: 'ok'
      });
    } finally {
      await loadToolApprovalRules();
    }
  };

  const handleEditMcpServer = (name: string) => {
    setEditingServerName(name);
    setEditingServerConfig(mcpServers[name]);
    setIsMcpDialogOpen(true);
  };

  const handleDeleteMcpServer = (name: string) => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('settings_mcp_delete_server_title'),
      description: t('settings_mcp_delete_server_message'),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: async () => {
        closeDialog(dialogId);
        const prev = { ...mcpServers };
        const next = { ...mcpServers };
        delete next[name];
        setMcpServers(next);
        setRulesLoaded(false);
        try {
          const response = await updateMcpServers(next);
          setMcpToolsByServer(response.tools);
          await reloadTools();
        } catch (error) {
          setMcpServers(prev);
          const detail =
            error instanceof ApiError && error.message ? error.message : '';
          openDialog({
            title: t('error'),
            description: detail
              ? `${t('error_delete_mcp_server')}\n${detail}`
              : t('error_delete_mcp_server'),
            type: 'ok'
          });
        } finally {
          await loadToolApprovalRules();
        }
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  const handleToggleToolApproval = async (
    toolName: string,
    currentlyApproved: boolean
  ) => {
    try {
      if (currentlyApproved) {
        const rule = toolApprovalRules.find(r => r.toolName === toolName);
        if (rule) {
          await deleteToolApprovalRule(rule.id);
        }
      } else {
        await upsertToolApprovalRule({ toolName, autoApprove: true });
      }
      await loadToolApprovalRules();
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_toggle_tool_approval'),
        type: 'ok'
      });
    }
  };

  const handleToggleServerApproval = async (
    serverName: string,
    enableAll: boolean
  ) => {
    const tools = mcpToolsByServer[serverName] ?? [];
    if (tools.length === 0) return;

    try {
      const response = await bulkUpdateToolApprovalRules({
        toolNames: tools,
        autoApprove: enableAll
      });
      setToolApprovalRules(response.rules);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_toggle_tool_approval'),
        type: 'ok'
      });
    }
  };

  const mcpServerEntries = Object.entries(mcpServers);
  const toolServerEntries = Object.entries(mcpToolsByServer);
  const hasMcpTools = toolServerEntries.some(([, tools]) => tools.length > 0);

  return (
    <>
      {!singleUserMode && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <Info className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p>{t('settings_shared_settings_description')}</p>
            {!isAdmin && (
              <p className="mt-1">{t('settings_shared_readonly')}</p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings_mcp_servers')}</CardTitle>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingServerName(undefined);
                setEditingServerConfig(undefined);
                setIsMcpDialogOpen(true);
              }}
              disabled={!mcpServersLoaded}
            >
              <Plus className="size-4 mr-1" />
              {t('settings_mcp_add_server')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!mcpServersLoaded && <McpServerListSkeleton />}

          {mcpServersLoaded && mcpServerEntries.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">
              {isAdmin
                ? t('settings_mcp_no_servers')
                : t('settings_mcp_no_servers_readonly')}
            </p>
          )}

          {mcpServersLoaded &&
            mcpServerEntries.map(([name, config]) => (
              <div
                key={name}
                className="flex items-center justify-between border rounded-lg p-4"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="font-medium">{name}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium mr-2">
                      {config.type === 'http' ? 'HTTP' : 'Stdio'}
                    </span>
                    {getMcpServerSummary(config)}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 ml-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditMcpServer(name)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('edit')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteMcpServer(name)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <McpServerDialog
          isOpen={isMcpDialogOpen}
          onClose={() => {
            setIsMcpDialogOpen(false);
            setEditingServerName(undefined);
            setEditingServerConfig(undefined);
          }}
          onSave={handleSaveMcpServer}
          initialName={editingServerName}
          initialConfig={editingServerConfig}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings_tool_approval_rules')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!mcpToolsLoaded || !rulesLoaded) && <ToolApprovalRulesSkeleton />}

          {mcpToolsLoaded && rulesLoaded && !hasMcpTools && (
            <p className="text-muted-foreground text-sm text-center py-8">
              {t('settings_no_mcp_tools')}
            </p>
          )}

          {mcpToolsLoaded &&
            rulesLoaded &&
            hasMcpTools &&
            toolServerEntries.map(([serverName, tools]) => {
              if (tools.length === 0) return null;
              const allApproved = tools.every(tool =>
                toolApprovalRules.some(
                  r => r.toolName === tool && r.autoApprove
                )
              );
              return (
                <div key={serverName} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      {serverName}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto py-0.5 px-1.5 text-xs"
                        onClick={() =>
                          handleToggleServerApproval(serverName, !allApproved)
                        }
                      >
                        {allApproved
                          ? t('tools_all_approve_off')
                          : t('tools_all_approve_on')}
                      </Button>
                    </div>
                  </div>
                  {tools.map(tool => {
                    const existingRule = toolApprovalRules.find(
                      r => r.toolName === tool
                    );
                    const isAutoApproved = existingRule?.autoApprove ?? false;

                    return (
                      <div
                        key={tool}
                        className="flex items-center justify-between border rounded-md p-3"
                      >
                        <span className="text-sm font-mono">{tool}</span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={isAutoApproved ? 'default' : 'outline'}
                            onClick={() =>
                              !isAutoApproved &&
                              handleToggleToolApproval(tool, false)
                            }
                            disabled={isAutoApproved}
                          >
                            {t('settings_auto_approve_on')}
                          </Button>
                          <Button
                            size="sm"
                            variant={!isAutoApproved ? 'default' : 'outline'}
                            onClick={() =>
                              isAutoApproved &&
                              handleToggleToolApproval(tool, true)
                            }
                            disabled={!isAutoApproved}
                          >
                            {t('settings_auto_approve_off')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </CardContent>
      </Card>
    </>
  );
}
