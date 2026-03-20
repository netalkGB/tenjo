import { Cable } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

interface ToolPickerProps {
  availableToolsByServer: Record<string, string[]>;
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
  enabledTools,
  onToggle,
  onToggleServer,
  onEnableAll,
  onDisableAll
}: ToolPickerProps) {
  const { t } = useTranslation();

  const serverEntries = Object.entries(availableToolsByServer);
  const totalCount = serverEntries.reduce(
    (sum, [, tools]) => sum + tools.length,
    0
  );

  if (totalCount === 0) return null;

  const enabledCount = enabledTools.size;
  const allEnabled = enabledCount === totalCount;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 gap-1.5 cursor-pointer">
          <Cable className="w-3.5 h-3.5" />
          <span className="text-xs">
            {enabledCount}/{totalCount}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{t('tools')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 px-1.5 text-xs cursor-pointer"
            onClick={allEnabled ? onDisableAll : onEnableAll}
          >
            {allEnabled ? t('tools_deselect_all') : t('tools_select_all')}
          </Button>
        </div>
        <div className="max-h-60 overflow-y-auto space-y-3">
          {serverEntries.map(([serverName, tools]) => {
            const checkState = getServerCheckState(tools, enabledTools);
            return (
              <div key={serverName}>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer">
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
