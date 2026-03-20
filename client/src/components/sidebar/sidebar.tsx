import { useNavigate } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { Settings as SettingsIcon } from 'lucide-react';
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

function SettingsButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" onClick={() => navigate('/settings')}>
          <SettingsIcon className="size-4" />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{t('settings')}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function Sidebar() {
  const { singleUserMode } = useUser();
  return (
    <SidebarRoot>
      <SidebarHeader>
        <SidebarLogo />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NewChatButton />
              <PinnedSection />
              <HistorySection />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {singleUserMode ? <SettingsButton /> : <UserProfile />}
      </SidebarFooter>
    </SidebarRoot>
  );
}
