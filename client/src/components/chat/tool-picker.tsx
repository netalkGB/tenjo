import { Cable, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { useDialog } from '@/hooks/useDialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

interface ToolPickerProps {
  availableToolsByServer: Record<string, string[]>;
  mcpToolErrors: Record<string, string>;
  enabledTools: Set<string>;
  onToggle: (toolName: string) => void;
  onToggleServer: (serverName: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

function getServerCheckState(
  tools: string[],
  enabledTools: Set<string>
): 'all' | 'some' | 'none' {
  const enabledCount = tools.filter(t => enabledTools.has(t)).length;
  if (enabledCount === 0) return 'none';
  if (enabledCount === tools.length) return 'all';
  return 'some';
}

export function ToolPicker({
  availableToolsByServer,
  mcpToolErrors,
  enabledTools,
  onToggle,
  onToggleServer,
  onEnableAll,
  onDisableAll
}: ToolPickerProps) {
  const { t } = useTranslation();
  const { openDialog } = useDialog();
  const navigate = useNavigate();

  const serverEntries = Object.entries(availableToolsByServer);
  const errorEntries = Object.entries(mcpToolErrors);
  const totalCount = serverEntries.reduce(
    (sum, [, tools]) => sum + tools.length,
    0
  );

  if (totalCount === 0 && errorEntries.length === 0) return null;

  const enabledCount = enabledTools.size;
  const allEnabled = enabledCount === totalCount && totalCount > 0;
  const hasErrors = errorEntries.length > 0;

  const showErrorDialog = () => {
    openDialog({
      title: t('tools_mcp_connection_error_title'),
      description: t('tools_mcp_connection_error_hint'),
      type: 'ok/cancel',
      okText: t('tools_mcp_go_to_settings'),
      cancelText: t('cancel'),
      onOk: () => navigate('/settings/tools-mcp')
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-1.5 cursor-pointer"
          data-testid="chat-input-mcp-tools-button"
        >
          <Cable className="w-3.5 h-3.5" />
          <span className="text-xs">
            {enabledCount}/{totalCount}
          </span>
          {hasErrors && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{t('tools')}</span>
          {totalCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 px-1.5 text-xs cursor-pointer"
              onClick={allEnabled ? onDisableAll : onEnableAll}
              data-testid="chat-input-mcp-tools-toggle-all-button"
            >
              {allEnabled ? t('tools_deselect_all') : t('tools_select_all')}
            </Button>
          )}
        </div>

        {hasErrors && (
          <button
            className="w-full flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2 mb-2 text-left cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
            onClick={showErrorDialog}
            data-testid="chat-input-mcp-tools-error-banner"
          >
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {t('tools_mcp_connection_errors', {
                count: String(errorEntries.length)
              })}
            </span>
          </button>
        )}

        <div className="max-h-60 overflow-y-auto space-y-3">
          {serverEntries.map(([serverName, tools]) => {
            const checkState = getServerCheckState(tools, enabledTools);
            return (
              <div key={serverName}>
                <label
                  className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer"
                  data-testid="chat-input-mcp-tools-server"
                >
                  <Checkbox
                    checked={
                      checkState === 'all'
                        ? true
                        : checkState === 'some'
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={() => onToggleServer(serverName)}
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    {serverName}
                  </span>
                </label>
                <div className="space-y-1 ml-4">
                  {tools.map(toolName => (
                    <label
                      key={toolName}
                      className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer"
                      data-testid="chat-input-mcp-tools-tool"
                    >
                      <Checkbox
                        checked={enabledTools.has(toolName)}
                        onCheckedChange={() => onToggle(toolName)}
                      />
                      <span className="text-sm truncate" title={toolName}>
                        {toolName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
