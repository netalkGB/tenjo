import { Link, useNavigate, useParams } from 'react-router';
import {
  SidebarMenuSubItem,
  SidebarMenuSubButton
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RenameDialogContent,
  RenameDialogFooter
} from '@/components/rename-dialog';
import { useDialog } from '@/hooks/useDialog';
import { useState } from 'react';
import { pinThread } from '@/api/server/chat';
import { useHistory } from '@/hooks/useHistory';
import { useTranslation } from '@/hooks/useTranslation';

interface ChatHistoryItemProps {
  title?: string;
  id?: string;
  skeleton?: boolean;
  pinned?: boolean;
}

export function ChatHistoryItem({
  title,
  id,
  skeleton = false,
  pinned = false
}: ChatHistoryItemProps) {
  const { openDialog, closeDialog } = useDialog();
  const { reload, reloadPinned, deleteHistory, renameHistory } = useHistory();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: currentThreadId } = useParams<{ id: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const testIdPrefix = `sidebar-${pinned ? 'pinned' : 'history'}-item`;

  if (skeleton) {
    return <Skeleton className="h-7 w-full" />;
  }

  const handleRename = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);

    if (!id || !title) return;

    const currentValueRef = { value: title };

    const handleRenameSubmit = async () => {
      if (!id || currentValueRef.value.trim().length === 0) return;

      await renameHistory(id, currentValueRef.value.trim());
      closeDialog(dialogId);
    };

    const dialogId = openDialog({
      type: 'custom',
      title: t('rename_title'),
      content: (
        <RenameDialogContent
          defaultValue={title}
          onValueChange={v => {
            currentValueRef.value = v;
          }}
        />
      ),
      customFooter: (
        <RenameDialogFooter
          isDisabled={false}
          onCancel={() => closeDialog(dialogId)}
          onSave={handleRenameSubmit}
        />
      ),
      showCloseButton: false,
      closeOnOutsideClick: false
    });
  };

  const handlePin = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);

    if (!id) return;

    try {
      await pinThread(id, !pinned);
      await reloadPinned();
      await reload();
    } catch {
      openDialog({
        title: t('error'),
        description: pinned ? t('unpin_failed') : t('pin_failed'),
        type: 'ok'
      });
    }
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);

    if (!id) return;

    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('delete_confirmation'),
      description: t('delete_confirmation_message'),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: () => {
        closeDialog(dialogId);

        if (currentThreadId === id) {
          navigate('/');
        }

        deleteHistory(id);
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  return (
    <SidebarMenuSubItem
      className="group/item"
      data-testid={`${testIdPrefix}-${id}`}
    >
      {/* Chat link with right padding to make room for the menu button */}
      <SidebarMenuSubButton asChild className="pr-8">
        <Link to={`/chat/${id}`} className="overflow-hidden">
          <span className="truncate">{title}</span>
        </Link>
      </SidebarMenuSubButton>
      {/* Three-dot menu button (horizontal dots) - shown on hover */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute right-0 top-0 bottom-0 w-6 opacity-0 group-hover/item:opacity-50 hover:opacity-100 hover:bg-accent rounded-md flex flex-row items-center justify-center gap-0.5"
            data-testid={`${testIdPrefix}-menu-button-${id}`}
          >
            <div className="size-0.5 bg-current rounded-full" />
            <div className="size-0.5 bg-current rounded-full" />
            <div className="size-0.5 bg-current rounded-full" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            onClick={handlePin}
            data-testid={`${testIdPrefix}-pin-menu-item-${id}`}
          >
            {pinned ? t('unpin') : t('pin')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleRename}
            data-testid={`${testIdPrefix}-rename-menu-item-${id}`}
          >
            {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={handleDelete}
            data-testid={`${testIdPrefix}-delete-menu-item-${id}`}
          >
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
