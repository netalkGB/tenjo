import { Wand2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function NewAgentTaskButton() {
  const { t } = useTranslation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild data-testid="sidebar-new-agent-task-button">
        <Link to="/agent">
          <Wand2 />
          <span>{t('agent_new_task')}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
