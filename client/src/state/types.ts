export type LoadingStatus = 'loading' | 'success' | 'error';

export interface History {
  id: string;
  title: string;
  pinned: boolean;
  createdAt?: Date;
}

export interface HistoryState {
  histories: History[];
  loadingStatus: LoadingStatus;
  isOpen: boolean;
  pinnedHistories: History[];
  pinnedLoadingStatus: LoadingStatus;
  isPinnedOpen: boolean;
}

export const HistoryActionType = {
  SET_LOADING_STATUS: 'SET_LOADING_STATUS',
  SET_HISTORIES: 'SET_HISTORIES',
  RENAME_HISTORY: 'RENAME_HISTORY',
  DELETE_HISTORY: 'DELETE_HISTORY',
  SET_OPEN: 'SET_OPEN',
  SET_PINNED_HISTORIES: 'SET_PINNED_HISTORIES',
  SET_PINNED_LOADING_STATUS: 'SET_PINNED_LOADING_STATUS',
  SET_PINNED_OPEN: 'SET_PINNED_OPEN'
} as const;

export type HistoryAction =
  | {
      type: typeof HistoryActionType.SET_LOADING_STATUS;
      payload: LoadingStatus;
    }
  | {
      type: typeof HistoryActionType.SET_HISTORIES;
      payload: History[];
    }
  | {
      type: typeof HistoryActionType.RENAME_HISTORY;
      payload: {
        id: string;
        title: string;
      };
    }
  | { type: typeof HistoryActionType.DELETE_HISTORY; payload: string }
  | { type: typeof HistoryActionType.SET_OPEN; payload: boolean }
  | { type: typeof HistoryActionType.SET_PINNED_HISTORIES; payload: History[] }
  | {
      type: typeof HistoryActionType.SET_PINNED_LOADING_STATUS;
      payload: LoadingStatus;
    }
  | { type: typeof HistoryActionType.SET_PINNED_OPEN; payload: boolean };
