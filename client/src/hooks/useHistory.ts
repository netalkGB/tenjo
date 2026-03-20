import { useHistoryContext } from '../contexts/history-context';
import { History, LoadingStatus, HistoryActionType } from '../state/types';
import {
  getThreads,
  getPinnedThreads,
  deleteThread,
  renameThread
} from '@/api/server/chat';
import { ApiThread } from '@/api/server/chat';

interface UseHistoryReturn {
  histories: History[];
  loadingStatus: LoadingStatus;
  reload: () => Promise<void>;
  setOpen: (isOpen: boolean) => void;
  isOpen: boolean;
  deleteHistory: (id: string) => Promise<void>;
  renameHistory: (id: string, title: string) => Promise<void>;
  pinnedHistories: History[];
  pinnedLoadingStatus: LoadingStatus;
  isPinnedOpen: boolean;
  setPinnedOpen: (isOpen: boolean) => void;
  reloadPinned: () => Promise<void>;
}

function mapThreadsToHistories(threads: ApiThread[]): History[] {
  return threads.map((thread: ApiThread) => ({
    id: thread.id,
    title: thread.title,
    pinned: thread.pinned,
    createdAt: thread.created_at || undefined
  }));
}

export function useHistory(): UseHistoryReturn {
  const { state, dispatch } = useHistoryContext();

  async function reload() {
    dispatch({
      type: HistoryActionType.SET_LOADING_STATUS,
      payload: 'loading'
    });
    try {
      const threads = await getThreads({
        pageSize: 10,
        pageNumber: 1
      });
      dispatch({
        type: HistoryActionType.SET_HISTORIES,
        payload: mapThreadsToHistories(threads.threads)
      });
    } catch {
      dispatch({
        type: HistoryActionType.SET_LOADING_STATUS,
        payload: 'error'
      });
    } finally {
      dispatch({
        type: HistoryActionType.SET_LOADING_STATUS,
        payload: 'success'
      });
    }
  }

  async function reloadPinned() {
    dispatch({
      type: HistoryActionType.SET_PINNED_LOADING_STATUS,
      payload: 'loading'
    });
    try {
      const result = await getPinnedThreads();
      dispatch({
        type: HistoryActionType.SET_PINNED_HISTORIES,
        payload: mapThreadsToHistories(result.threads)
      });
    } catch {
      dispatch({
        type: HistoryActionType.SET_PINNED_LOADING_STATUS,
        payload: 'error'
      });
    } finally {
      dispatch({
        type: HistoryActionType.SET_PINNED_LOADING_STATUS,
        payload: 'success'
      });
    }
  }

  async function deleteHistory(id: string) {
    await deleteThread(id);
    await reload();
    await reloadPinned();
  }

  async function renameHistory(id: string, title: string) {
    await renameThread(id, title);
    await reload();
    await reloadPinned();
  }

  function setOpen(isOpen: boolean) {
    dispatch({
      type: HistoryActionType.SET_OPEN,
      payload: isOpen
    });
  }

  function setPinnedOpen(isOpen: boolean) {
    dispatch({
      type: HistoryActionType.SET_PINNED_OPEN,
      payload: isOpen
    });
  }

  return {
    histories: state.histories,
    loadingStatus: state.loadingStatus,
    reload,
    setOpen,
    isOpen: state.isOpen,
    deleteHistory,
    renameHistory,
    pinnedHistories: state.pinnedHistories,
    pinnedLoadingStatus: state.pinnedLoadingStatus,
    isPinnedOpen: state.isPinnedOpen,
    setPinnedOpen,
    reloadPinned
  };
}
