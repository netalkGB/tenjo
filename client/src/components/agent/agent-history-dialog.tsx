import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { HistoryCard } from '@/components/history/history-card';
import { HistoryPagination } from '@/components/history';
import {
  RenameDialogContent,
  RenameDialogFooter
} from '@/components/rename-dialog';
import { useDialog } from '@/hooks/useDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { getRelativeTime } from '@/lib/utils';
import { useAgentHistory } from '@/contexts/agent-history-context';
import {
  listAgentProjects,
  patchAgentProject,
  deleteAgentProject,
  type AgentProjectDto
} from '@/api/server/agent';

const PAGE_SIZE = 15;

interface AgentHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AgentHistoryListState {
  projects: AgentProjectDto[];
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
}

export function AgentHistoryDialog({
  isOpen,
  onClose
}: AgentHistoryDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openDialog, closeDialog } = useDialog();
  const { reload: reloadSidebar } = useAgentHistory();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [listState, setListState] = useState<AgentHistoryListState>({
    projects: [],
    currentPage: 1,
    totalPages: 1,
    isLoading: true
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const hasOpenedRef = useRef(false);
  const latestListStateRef = useRef({
    currentPage: listState.currentPage,
    debouncedQuery,
    isOpen
  });
  latestListStateRef.current = {
    currentPage: listState.currentPage,
    debouncedQuery,
    isOpen
  };

  // Track the previous list to decide whether to restore the scroll position
  const prevProjectIdsRef = useRef<string[]>([]);

  const fetchProjects = async (
    page: number,
    search?: string
  ): Promise<boolean> => {
    setListState(prev => ({ ...prev, isLoading: true }));
    try {
      const response = await listAgentProjects({
        pageSize: PAGE_SIZE,
        page,
        search: search || undefined
      });

      // If the requested page is beyond totalPages, fall back to the last page
      if (
        response.projects.length === 0 &&
        response.totalPages > 0 &&
        page > response.totalPages
      ) {
        return fetchProjects(response.totalPages, search);
      }

      const newIds = response.projects.map(p => p.id);
      const changed =
        prevProjectIdsRef.current.length !== newIds.length ||
        prevProjectIdsRef.current.some((id, i) => id !== newIds[i]);
      prevProjectIdsRef.current = newIds;

      setListState({
        projects: response.projects,
        currentPage: response.currentPage,
        totalPages: response.totalPages,
        isLoading: false
      });
      return changed;
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_threads'),
        type: 'ok'
      });
      setListState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  };

  // Keep a ref to the latest fetchProjects to avoid stale closures in effects
  const fetchProjectsRef = useRef(fetchProjects);
  fetchProjectsRef.current = fetchProjects;

  // Save scroll position when dialog closes
  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (prevIsOpen.current && !isOpen && scrollContainerRef.current) {
      savedScrollTop.current = scrollContainerRef.current.scrollTop;
    }
    prevIsOpen.current = isOpen;
  }, [isOpen]);

  // Fetch data every time the dialog opens, preserving current page and search
  useEffect(() => {
    if (!isOpen) return;

    if (!hasOpenedRef.current) {
      hasOpenedRef.current = true;
      fetchProjectsRef.current(1);
      return;
    }

    const { currentPage: latestPage, debouncedQuery: latestSearch } =
      latestListStateRef.current;

    // Refetch current page; restore scroll only if data hasn't changed
    fetchProjectsRef
      .current(latestPage, latestSearch || undefined)
      .then(changed => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = changed
              ? 0
              : savedScrollTop.current;
          }
        });
      });
  }, [isOpen]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch when debounced query changes (reset to page 1)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!latestListStateRef.current.isOpen) return;
    fetchProjectsRef.current(1, debouncedQuery || undefined);
  }, [debouncedQuery]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handlePageChange = (page: number) => {
    fetchProjects(page, debouncedQuery || undefined);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const handleTaskClick = (taskId: string) => {
    onClose();
    navigate(`/agent/task/${taskId}`);
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const result = getRelativeTime(new Date(iso));
    if (!result) return '';
    const { unit, value } = result;
    switch (unit) {
      case 'just_now':
        return t('just_now');
      case 'minutes':
        return `${value} ${t('minutes_ago')}`;
      case 'hours':
        return `${value} ${t('hours_ago')}`;
      case 'yesterday':
        return t('yesterday');
      case 'days':
        return `${value} ${t('days_ago')}`;
      case 'months':
        return `${value} ${t('months_ago')}`;
      case 'years':
        return `${value} ${t('years_ago')}`;
    }
  };

  const handleTogglePin = async (
    event: React.MouseEvent,
    id: string,
    pinned: boolean
  ) => {
    event.stopPropagation();
    try {
      await patchAgentProject(id, { pinned: !pinned });
      await fetchProjects(listState.currentPage, debouncedQuery || undefined);
      await reloadSidebar();
    } catch {
      openDialog({
        title: t('error'),
        description: pinned ? t('unpin_failed') : t('pin_failed'),
        type: 'ok'
      });
    }
  };

  const handleRename = (event: React.MouseEvent, id: string, title: string) => {
    event.stopPropagation();
    const currentValueRef = { value: title };
    const handleRenameSubmit = async () => {
      if (currentValueRef.value.trim().length === 0) return;
      await patchAgentProject(id, { title: currentValueRef.value.trim() });
      closeDialog(dialogId);
      await fetchProjects(listState.currentPage, debouncedQuery || undefined);
      await reloadSidebar();
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

  const handleDelete = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
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
        deleteAgentProject(id).then(async () => {
          await fetchProjects(
            listState.currentPage,
            debouncedQuery || undefined
          );
          await reloadSidebar();
        });
      },
      onCancel: () => closeDialog(dialogId)
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl h-[min(80vh,100dvh-2rem)] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{t('history')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col flex-1 overflow-hidden px-6 pb-6">
          {/* Search Box */}
          <div className="my-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('search_history')}
                value={searchQuery}
                onChange={handleSearch}
                className="pl-9 h-11"
                data-testid="agent-history-dialog-search-input"
              />
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
            {/* Loading State */}
            {listState.isLoading &&
              Array.from({ length: PAGE_SIZE }).map((_, index) => (
                <HistoryCard key={index} skeleton />
              ))}

            {/* Empty State */}
            {!listState.isLoading && listState.projects.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? t('no_search_results') : t('no_history')}
              </div>
            )}

            {/* Project List */}
            {!listState.isLoading &&
              listState.projects.map(project => (
                <div
                  key={project.id}
                  onClick={() => handleTaskClick(project.id)}
                  data-testid={`agent-history-dialog-item-${project.id}`}
                >
                  <HistoryCard
                    title={project.title || '-'}
                    date={formatDate(project.updatedAt)}
                    pinned={project.pinned}
                    onTogglePin={e =>
                      handleTogglePin(e, project.id, project.pinned)
                    }
                    onRename={e =>
                      handleRename(e, project.id, project.title || '-')
                    }
                    onDelete={e => handleDelete(e, project.id)}
                  />
                </div>
              ))}
          </div>

          {/* Pagination */}
          {listState.isLoading ? (
            <div className="mt-4">
              <HistoryPagination skeleton />
            </div>
          ) : (
            listState.totalPages > 1 && (
              <div className="mt-4">
                <HistoryPagination
                  currentPage={listState.currentPage}
                  totalPages={listState.totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
