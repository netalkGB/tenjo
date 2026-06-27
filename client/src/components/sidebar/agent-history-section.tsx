import { ChevronRight, MessageSquare } from 'lucide-react';
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
import { AgentHistoryDialog } from '@/components/agent/agent-history-dialog';
import { useAgentHistory } from '@/contexts/agent-history-context';

export function AgentHistorySection() {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { projects } = useAgentHistory();

  return (
    <>
      <Collapsible
        className="group/collapsible"
        open={isOpen}
        onOpenChange={setOpen}
      >
        <SidebarMenuItem className="relative">
          <SidebarMenuButton
            className="cursor-pointer"
            onClick={() => setIsDialogOpen(true)}
            data-testid="sidebar-agent-history-button"
          >
            <MessageSquare />
            <span>{t('history')}</span>
          </SidebarMenuButton>
          <CollapsibleTrigger asChild>
            <button
              className="absolute right-0 top-0 bottom-0 w-8 hover:bg-accent rounded-md flex items-center justify-center"
              onClick={e => e.stopPropagation()}
              data-testid="sidebar-agent-history-collapse-button"
            >
              <ChevronRight className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </button>
          </CollapsibleTrigger>
        </SidebarMenuItem>
        <CollapsibleContent>
          <SidebarMenuSub>
            {projects.map(project => (
              <AgentHistoryItem
                key={project.id}
                id={project.id}
                title={project.title}
                pinned={project.pinned}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
      <AgentHistoryDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      />
    </>
  );
}
