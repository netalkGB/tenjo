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
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAgentHistory } from '@/contexts/agent-history-context';
import { Skeleton } from '@/components/ui/skeleton';
import { isTitlePending } from '@/lib/titleState';

interface AgentTaskTitleHeaderProps {
  projectId: string;
  title: string;
}

function truncateTitle(title: string): string {
  const maxLength = 25;
  return title.length > maxLength
    ? `${title.substring(0, maxLength)}...`
    : title;
}

export function AgentTaskTitleHeader({
  projectId,
  title
}: AgentTaskTitleHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openDialog, closeDialog } = useDialog();
  const { projects, togglePin, renameProject, deleteProject } =
    useAgentHistory();
  const [menuOpen, setMenuOpen] = useState(false);

  const project = projects.find(p => p.id === projectId);
  const pinned = project?.pinned ?? false;
  const displayName = project?.title || title;
  const titlePending = isTitlePending(displayName);

  const handlePin = async () => {
    setMenuOpen(false);
    try {
      await togglePin(projectId, !pinned);
    } catch {
      openDialog({
        title: t('error'),
        description: pinned ? t('unpin_failed') : t('pin_failed'),
        type: 'ok'
      });
    }
  };

  const handleRename = () => {
    setMenuOpen(false);
    const currentValueRef = { value: displayName };
    const handleRenameSubmit = async () => {
      if (currentValueRef.value.trim().length === 0) return;
      await renameProject(projectId, currentValueRef.value.trim());
      closeDialog(dialogId);
    };
    const dialogId = openDialog({
      type: 'custom',
      title: t('rename_title'),
      content: (
        <RenameDialogContent
          defaultValue={displayName}
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

  const handleDelete = () => {
    setMenuOpen(false);
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('delete_confirmation'),
      description: t('agent_delete_confirmation_message'),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: () => {
        closeDialog(dialogId);
        deleteProject(projectId).finally(() => navigate('/agent'));
      },
      onCancel: () => closeDialog(dialogId)
    });
  };

  const displayTitle = truncateTitle(displayName);

  if (titlePending) {
    return <Skeleton className="h-5 w-54" />;
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-sm" data-testid="agent-task-title">
        {displayTitle}
      </span>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex items-center justify-center rounded-md p-0.5 hover:bg-accent"
            data-testid="agent-task-title-menu-button"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={handlePin}
            data-testid="agent-task-title-pin-menu-item"
          >
            {pinned ? t('unpin') : t('pin')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleRename}
            data-testid="agent-task-title-rename-menu-item"
          >
            {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={handleDelete}
            data-testid="agent-task-title-delete-menu-item"
          >
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
