import { ChevronRight, Pin } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@radix-ui/react-collapsible';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub
} from '@/components/ui/sidebar';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { AgentHistoryItem } from '@/components/agent/agent-history-item';
import { useAgentHistory } from '@/contexts/agent-history-context';

export function AgentPinnedSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const { pinned } = useAgentHistory();

  if (pinned.length === 0) return null;

  return (
    <Collapsible
      className="group/agent-pinned"
      open={open}
      onOpenChange={setOpen}
    >
      <SidebarMenuItem className="relative">
        <SidebarMenuButton data-testid="sidebar-agent-pinned-button">
          <Pin className="size-4" />
          <span>{t('pinned')}</span>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <button
            className="absolute right-0 top-0 bottom-0 w-8 hover:bg-accent rounded-md flex items-center justify-center"
            onClick={e => e.stopPropagation()}
            data-testid="sidebar-agent-pinned-collapse-button"
          >
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/agent-pinned:rotate-90" />
          </button>
        </CollapsibleTrigger>
      </SidebarMenuItem>
      <CollapsibleContent>
        <SidebarMenuSub>
          {pinned.map(project => (
            <AgentHistoryItem
              key={project.id}
              id={project.id}
              title={project.title}
              pinned
            />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}
