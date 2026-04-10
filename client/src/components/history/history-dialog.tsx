import { HistoryCard } from '@/components/history/history-card';
import { HistoryPagination } from '@/components/history';
import { useTranslation } from '@/hooks/useTranslation';
import { Input } from '@/components/ui/input';
import {
  RenameDialogContent,
  RenameDialogFooter
} from '@/components/rename-dialog';
import { Search } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { getThreads, ApiThread, pinThread } from '@/api/server/chat';
import { useNavigate } from 'react-router';
import { getRelativeTime } from '@/lib/utils';
import { useDialog } from '@/hooks/useDialog';
import { useHistory } from '@/hooks/useHistory';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const PAGE_SIZE = 15;

interface HistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HistoryDialog({ isOpen, onClose }: HistoryDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openDialog, closeDialog } = useDialog();
  const {
    reload: reloadSidebar,
    reloadPinned,
    deleteHistory,
    renameHistory
  } = useHistory();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [threads, setThreads] = useState<ApiThread[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const initialized = useRef(false);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const debouncedQueryRef = useRef(debouncedQuery);
  debouncedQueryRef.current = debouncedQuery;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // Returns whether the thread list changed compared to the previous state
  const prevThreadIdsRef = useRef<string[]>([]);

  const fetchThreads = async (
    page: number,
    searchWord?: string
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const response = await getThreads({
        pageSize: PAGE_SIZE,
        pageNumber: page,
        searchWord: searchWord || undefined
      });

      // If the requested page is beyond totalPages, fall back to the last page
      if (
        response.threads.length === 0 &&
        response.totalPages > 0 &&
        page > response.totalPages
      ) {
        return fetchThreads(response.totalPages, searchWord);
      }

      const newIds = response.threads.map(th => th.id);
      const changed =
        prevThreadIdsRef.current.length !== newIds.length ||
        prevThreadIdsRef.current.some((id, i) => id !== newIds[i]);
      prevThreadIdsRef.current = newIds;

      setThreads(response.threads);
      setTotalPages(response.totalPages);
      setCurrentPage(response.currentPage);
      return changed;
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_threads'),
        type: 'ok'
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Keep a ref to the latest fetchThreads to avoid stale closures in effects
  const fetchThreadsRef = useRef(fetchThreads);
  fetchThreadsRef.current = fetchThreads;

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

    if (!initialized.current) {
      initialized.current = true;
      fetchThreadsRef.current(1);
      return;
    }

    // Refetch current page; restore scroll only if data hasn't changed
    fetchThreadsRef
      .current(currentPageRef.current, debouncedQueryRef.current || undefined)
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
    if (!isOpenRef.current) return;
    fetchThreadsRef.current(1, debouncedQuery || undefined);
  }, [debouncedQuery]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handlePageChange = (page: number) => {
    fetchThreads(page, debouncedQuery || undefined);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const handleThreadClick = (threadId: string) => {
    onClose();
    navigate(`/chat/${threadId}`);
  };

  const handleTogglePin = async (
    event: React.MouseEvent,
    threadId: string,
    currentPinned: boolean
  ) => {
    event.stopPropagation();
    try {
      await pinThread(threadId, !currentPinned);
      await fetchThreads(currentPage, debouncedQuery || undefined);
      await reloadSidebar();
      await reloadPinned();
    } catch {
      openDialog({
        title: t('error'),
        description: currentPinned ? t('unpin_failed') : t('pin_failed'),
        type: 'ok'
      });
    }
  };

  const handleRenameThread = (
    event: React.MouseEvent,
    threadId: string,
    currentTitle: string
  ) => {
    event.stopPropagation();

    const currentValueRef = { value: currentTitle };

    const handleRenameSubmit = async () => {
      if (currentValueRef.value.trim().length === 0) return;

      await renameHistory(threadId, currentValueRef.value.trim());
      closeDialog(dialogId);
      fetchThreads(currentPage, debouncedQuery || undefined);
    };

    const dialogId = openDialog({
      type: 'custom',
      title: t('rename_title'),
      content: (
        <RenameDialogContent
          defaultValue={currentTitle}
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

  const handleDeleteThread = (event: React.MouseEvent, threadId: string) => {
    event.stopPropagation();

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
        deleteHistory(threadId).then(() => {
          fetchThreads(currentPage, debouncedQuery || undefined);
        });
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  const formatDate = (date: Date | null): string => {
    const result = getRelativeTime(date);
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
                data-testid="history-dialog-search-input"
              />
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
            {/* Loading State */}
            {isLoading &&
              Array.from({ length: PAGE_SIZE }).map((_, index) => (
                <HistoryCard key={index} skeleton />
              ))}

            {/* Empty State */}
            {!isLoading && threads.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery
                  ? t('no_search_results') || 'No search results found'
                  : t('no_history') || 'No chat history yet'}
              </div>
            )}

            {/* Thread List */}
            {!isLoading &&
              threads.map(thread => (
                <div
                  key={thread.id}
                  onClick={() => handleThreadClick(thread.id)}
                  data-testid={`history-dialog-item-${thread.id}`}
                >
                  <HistoryCard
                    title={thread.title || t('untitled') || 'Untitled'}
                    date={formatDate(thread.updated_at || thread.created_at)}
                    pinned={thread.pinned}
                    onTogglePin={e =>
                      handleTogglePin(e, thread.id, thread.pinned)
                    }
                    onRename={e =>
                      handleRenameThread(
                        e,
                        thread.id,
                        thread.title || t('untitled') || 'Untitled'
                      )
                    }
                    onDelete={e => handleDeleteThread(e, thread.id)}
                  />
                </div>
              ))}
          </div>

          {/* Pagination */}
          {isLoading ? (
            <div className="mt-4">
              <HistoryPagination skeleton />
            </div>
          ) : (
            totalPages > 1 && (
              <div className="mt-4">
                <HistoryPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
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
