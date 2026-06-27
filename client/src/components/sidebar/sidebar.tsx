import { useNavigate } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { Settings as SettingsIcon, BookOpen } from 'lucide-react';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar';
import { useUser } from '@/hooks/useUser';
import { SidebarLogo } from './sidebar-logo';
import { NewChatButton } from './new-chat-button';
import { PinnedSection } from './pinned-section';
import { HistorySection } from './history-section';
import { UserProfile } from './user-profile';
import { useSidebarMode } from '@/hooks/useSidebarMode';
import { ModeTabs } from './mode-tabs';
import { NewAgentTaskButton } from './new-agent-task-button';
import { AgentPinnedSection } from './agent-pinned-section';
import { AgentHistorySection } from './agent-history-section';

function KnowledgeButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="cursor-pointer"
        onClick={() => navigate('/knowledge')}
        data-testid="sidebar-knowledge-button"
      >
        <BookOpen className="size-4" />
        <span>{t('knowledge')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SettingsButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          onClick={() => navigate('/settings')}
          data-testid="sidebar-settings-button"
        >
          <SettingsIcon className="size-4" />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{t('settings')}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ChatMenu() {
  return (
    <SidebarMenu>
      <NewChatButton />
      <KnowledgeButton />
      <PinnedSection />
      <HistorySection />
    </SidebarMenu>
  );
}

function AgentMenu() {
  return (
    <SidebarMenu>
      <NewAgentTaskButton />
      <KnowledgeButton />
      <AgentPinnedSection />
      <AgentHistorySection />
    </SidebarMenu>
  );
}

export function Sidebar() {
  const { singleUserMode } = useUser();
  const mode = useSidebarMode();

  return (
    <SidebarRoot data-testid="sidebar">
      <SidebarHeader>
        <SidebarLogo />
        <ModeTabs />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {mode === 'agent' ? <AgentMenu /> : <ChatMenu />}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {singleUserMode ? <SettingsButton /> : <UserProfile />}
      </SidebarFooter>
    </SidebarRoot>
  );
}
