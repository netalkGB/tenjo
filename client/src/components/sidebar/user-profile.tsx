import { ChevronUp, User2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useNavigate } from 'react-router';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useDialog } from '@/hooks/useDialog';
import { useUser } from '@/hooks/useUser';
import { logout } from '@/api/server/logout';

export function UserProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openDialog, closeDialog } = useDialog();
  const { userName } = useUser();

  const handleSignOut = () => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('sign_out_confirmation'),
      description: t('sign_out_confirmation_message'),
      okText: t('sign_out'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: async () => {
        try {
          await logout();
          window.location.replace('/');
        } catch {
          closeDialog(dialogId);
          openDialog({
            title: t('error'),
            description: t('sign_out_failed'),
            type: 'ok'
          });
        }
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-linear-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800">
                <User2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{userName}</span>
              </div>
              <ChevronUp className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
          >
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <span>{t('settings')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut}>
              <span>{t('sign_out')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
