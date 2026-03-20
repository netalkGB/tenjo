import { SquarePlus } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function NewChatButton() {
  const { t } = useTranslation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link to="/">
          <SquarePlus />
          <span>{t('new_chat')}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
