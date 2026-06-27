import { useState, type MouseEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Cable,
  ChevronRight,
  Globe,
  Paperclip,
  Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { useSettings } from '@/contexts/settings-context';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebSearchToggle } from '@/hooks/useWebSearchToggle';
import { KnowledgePanel } from '@/components/chat/knowledge-picker';
import { ToolPanel } from '@/components/chat/tool-picker';

type SubPanel = 'knowledge' | 'tools';

interface AgentOptionsMenuProps {
  onAttachFile: () => void;
}

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  active?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Context-menu-like submenu behavior: fired on hover and keyboard focus. */
  onHover?: () => void;
  testId: string;
}

function MenuRow({
  icon,
  label,
  trailing,
  active = false,
  onClick,
  onHover,
  testId
}: MenuRowProps) {
  return (
    <button
      type="button"
      className={`flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer ${
        active ? 'bg-accent' : ''
      }`}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      data-testid={testId}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  );
}

/**
 * Single "+" button consolidating the agent prompt toolbar: file attach,
 * web search toggle, knowledge picker, and MCP tool picker. Knowledge and
 * tools expand as a second column to the right of the menu.
 */
export function AgentOptionsMenu({ onAttachFile }: AgentOptionsMenuProps) {
  const { t } = useTranslation();
  const {
    knowledgeList,
    selectedKnowledge,
    toggleKnowledge,
    availableToolsByServer,
    mcpToolErrors,
    enabledTools,
    toggleTool,
    toggleServerTools,
    enableAllTools,
    disableAllTools
  } = useSettings();
  const { webSearchEnabled, toggleWebSearch } = useWebSearchToggle();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<SubPanel | null>(null);

  const totalToolCount = Object.values(availableToolsByServer).reduce(
    (sum, tools) => sum + tools.length,
    0
  );
  const hasToolErrors = Object.keys(mcpToolErrors).length > 0;
  const showTools = totalToolCount > 0 || hasToolErrors;
  const showKnowledge = knowledgeList.length > 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setExpanded(null);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-9 h-9 cursor-pointer shrink-0"
          aria-label={t('agent_options')}
          data-testid="agent-prompt-options-button"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto items-stretch p-0">
        <div className="w-56 space-y-0.5 p-1">
          <MenuRow
            icon={<Paperclip className="w-4 h-4" />}
            label={t('agent_attach_file')}
            onClick={() => {
              setOpen(false);
              onAttachFile();
            }}
            onHover={() => setExpanded(null)}
            testId="agent-prompt-attach-button"
          />
          <MenuRow
            icon={<Globe className="w-4 h-4" />}
            label={t('web_search')}
            trailing={
              <span
                className={`text-xs ${
                  webSearchEnabled
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                {webSearchEnabled ? t('on') : t('off')}
              </span>
            }
            onClick={event => {
              // Enabling opens a confirmation dialog — close the menu so
              // the dialog doesn't fight the popover for focus.
              if (!webSearchEnabled) setOpen(false);
              toggleWebSearch(event);
            }}
            onHover={() => setExpanded(null)}
            testId="agent-prompt-web-search-button"
          />
          {showKnowledge && (
            <MenuRow
              icon={<BookOpen className="w-4 h-4" />}
              label={t('knowledge')}
              active={expanded === 'knowledge'}
              trailing={
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {selectedKnowledge.size > 0 && selectedKnowledge.size}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              }
              onClick={() => setExpanded('knowledge')}
              onHover={() => setExpanded('knowledge')}
              testId="agent-prompt-knowledge-button"
            />
          )}
          {showTools && (
            <MenuRow
              icon={<Cable className="w-4 h-4" />}
              label={t('tools')}
              active={expanded === 'tools'}
              trailing={
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {hasToolErrors && (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  {enabledTools.size}/{totalToolCount}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              }
              onClick={() => setExpanded('tools')}
              onHover={() => setExpanded('tools')}
              testId="agent-prompt-tools-button"
            />
          )}
        </div>
        {expanded && (
          <div className="w-72 border-l p-3">
            {expanded === 'knowledge' ? (
              <KnowledgePanel
                selectedIds={selectedKnowledge}
                onToggle={toggleKnowledge}
              />
            ) : (
              <ToolPanel
                availableToolsByServer={availableToolsByServer}
                mcpToolErrors={mcpToolErrors}
                enabledTools={enabledTools}
                onToggle={toggleTool}
                onToggleServer={toggleServerTools}
                onEnableAll={enableAllTools}
                onDisableAll={disableAllTools}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
