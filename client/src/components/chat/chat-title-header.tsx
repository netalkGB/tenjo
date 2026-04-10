import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  RenameDialogContent,
  RenameDialogFooter
} from '@/components/rename-dialog';
import { useDialog } from '@/hooks/useDialog';
import { useHistory } from '@/hooks/useHistory';
import { useTranslation } from '@/hooks/useTranslation';
import { pinThread } from '@/api/server/chat';

interface ChatTitleHeaderProps {
  threadId: string;
  title: string;
  pinned: boolean;
  onTitleChange: (newTitle: string) => void;
}

export function ChatTitleHeader({
  threadId,
  title,
  pinned,
  onTitleChange
}: ChatTitleHeaderProps) {
  const { openDialog, closeDialog } = useDialog();
  const { reload, reloadPinned, renameHistory, deleteHistory } = useHistory();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentPinned, setCurrentPinned] = useState(pinned);

  const handleRename = () => {
    setMenuOpen(false);

    const currentValueRef = { value: title };

    const handleRenameSubmit = async () => {
      if (currentValueRef.value.trim().length === 0) return;

      await renameHistory(threadId, currentValueRef.value.trim());
      onTitleChange(currentValueRef.value.trim());
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

  const handlePin = async () => {
    setMenuOpen(false);

    try {
      await pinThread(threadId, !currentPinned);
      setCurrentPinned(!currentPinned);
      await reloadPinned();
      await reload();
    } catch {
      openDialog({
        title: t('error'),
        description: currentPinned ? t('unpin_failed') : t('pin_failed'),
        type: 'ok'
      });
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);

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
        navigate('/');
        deleteHistory(threadId);
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  // Truncate title to 25 characters
  const displayTitle =
    title.length > 25 ? `${title.substring(0, 25)}...` : title;

  return (
    <div className="flex items-center gap-1">
      <span className="text-sm" data-testid="chat-title">
        {displayTitle}
      </span>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex items-center justify-center rounded-md p-0.5 hover:bg-accent"
            data-testid="chat-title-menu-button"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={handlePin}
            data-testid="chat-title-pin-menu-item"
          >
            {currentPinned ? t('unpin') : t('pin')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleRename}
            data-testid="chat-title-rename-menu-item"
          >
            {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={handleDelete}
            data-testid="chat-title-delete-menu-item"
          >
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
