import { HistoryCard } from '@/components/history/history-card';
import { HistoryPagination } from '@/components/history';
import { MainLayout } from '../layout';
import { useTranslation } from '@/hooks/useTranslation';
import { Input } from '@/components/ui/input';
import {
  RenameDialogContent,
  RenameDialogFooter
} from '@/components/rename-dialog';
import { Search } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, Suspense, use } from 'react';
import {
  getThreads,
  ApiThread,
  GetThreadsResponse,
  pinThread
} from '@/api/server/chat';
import { useNavigate, useSearchParams, useLoaderData } from 'react-router';
import { getRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useDialog } from '@/hooks/useDialog';
import { useHistory } from '@/hooks/useHistory';

interface LoaderData {
  data: Promise<GetThreadsResponse>;
  searchWord: string | undefined;
  pageSize: number;
}

function HistorySkeleton() {
  const { t } = useTranslation();
  const pageSize = 15;

  return (
    <MainLayout
      header={<span className="text-sm">{t('history')}</span>}
      content={
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 w-[85%] mx-auto">
              <div className="mb-3">
                <Skeleton className="h-11 w-full" />
              </div>
              {Array.from({ length: pageSize }).map((_, index) => (
                <HistoryCard key={index} skeleton />
              ))}
              <div className="mt-4">
                <HistoryPagination skeleton />
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}

export function History() {
  const { data, searchWord, pageSize } = useLoaderData() as LoaderData;

  return (
    <Suspense fallback={<HistorySkeleton />}>
      <HistoryContent
        dataPromise={data}
        initialSearchWord={searchWord}
        pageSize={pageSize}
      />
    </Suspense>
  );
}

interface HistoryContentProps {
  dataPromise: Promise<GetThreadsResponse>;
  initialSearchWord: string | undefined;
  pageSize: number;
}

function HistoryContent({
  dataPromise,
  initialSearchWord,
  pageSize
}: HistoryContentProps) {
  const initialData = use(dataPromise);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { openDialog, closeDialog } = useDialog();
  const {
    reload: reloadSidebar,
    reloadPinned,
    deleteHistory,
    renameHistory
  } = useHistory();
  const isInitialMount = useRef(true);

  const [searchQuery, setSearchQuery] = useState(initialSearchWord ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(initialSearchWord ?? '');
  const [threads, setThreads] = useState<ApiThread[]>(initialData.threads);
  const [currentPage, setCurrentPage] = useState(initialData.currentPage);
  const [totalPages, setTotalPages] = useState(initialData.totalPages);
  const [isLoading, setIsLoading] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync state when initialData changes.
  useEffect(() => {
    setThreads(initialData.threads);
    setCurrentPage(initialData.currentPage);
    setTotalPages(initialData.totalPages);
    setSearchQuery(initialSearchWord ?? '');
    setDebouncedQuery(initialSearchWord ?? '');
  }, [initialData, initialSearchWord]);

  // Function to fetch history data.
  const fetchThreads = useCallback(
    async (page: number, searchWord?: string) => {
      setIsLoading(true);
      try {
        const response = await getThreads({
          pageSize,
          pageNumber: page,
          searchWord: searchWord || undefined
        });
        setThreads(response.threads);
        setTotalPages(response.totalPages);
        setCurrentPage(response.currentPage);
      } catch {
        openDialog({
          title: t('error'),
          description: t('error_load_threads'),
          type: 'ok'
        });
      } finally {
        setIsLoading(false);
      }
    },
    [pageSize, openDialog, t]
  );

  // Timer for debouncing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Update URL when the user changes the search query (reset to page 1).
  useEffect(() => {
    // Skip on initial mount.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Only fetch and update URL if the value differs from the initial value.
    if (debouncedQuery !== (initialSearchWord ?? '')) {
      const newPage = 1;
      const params = new URLSearchParams();
      if (debouncedQuery) {
        params.set('q', debouncedQuery);
      }
      params.set('page', String(newPage));
      setSearchParams(params, { replace: true });
      fetchThreads(newPage, debouncedQuery || undefined);
    }
  }, [debouncedQuery, initialSearchWord, setSearchParams, fetchThreads]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handlePageChange = (page: number) => {
    // Update URL parameters.
    const params = new URLSearchParams();
    if (debouncedQuery) {
      params.set('q', debouncedQuery);
    }
    params.set('page', String(page));
    setSearchParams(params, { replace: true });
    fetchThreads(page, debouncedQuery || undefined);

    // Scroll back to the top.
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const handleThreadClick = (threadId: string) => {
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
    <MainLayout
      header={<span className="text-sm">{t('history')}</span>}
      content={
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
          <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
            <div className="p-4 w-[85%] mx-auto">
              {/* Search Box */}
              <div className="mb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder={t('search_history')}
                    value={searchQuery}
                    onChange={handleSearch}
                    className="pl-9 h-11"
                  />
                </div>
              </div>

              {/* Loading State */}
              {isLoading &&
                Array.from({ length: pageSize }).map((_, index) => (
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
          </div>
        </div>
      }
    />
  );
}
