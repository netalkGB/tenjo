import { HistoryState, HistoryAction, HistoryActionType } from './types';

export const initialHistoryState: HistoryState = {
  histories: [],
  loadingStatus: 'loading',
  isOpen: true,
  pinnedHistories: [],
  pinnedLoadingStatus: 'loading',
  isPinnedOpen: true
};

export const historyReducer = (
  state: HistoryState,
  action: HistoryAction
): HistoryState => {
  switch (action.type) {
    case HistoryActionType.SET_LOADING_STATUS:
      return {
        ...state,
        loadingStatus: action.payload
      };

    case HistoryActionType.SET_HISTORIES:
      return {
        ...state,
        histories: action.payload
      };

    case HistoryActionType.SET_OPEN:
      return {
        ...state,
        isOpen: action.payload
      };

    case HistoryActionType.RENAME_HISTORY:
      return {
        ...state,
        histories: state.histories.map(history =>
          history.id === action.payload.id
            ? { ...history, title: action.payload.title }
            : history
        )
      };

    case HistoryActionType.DELETE_HISTORY:
      return {
        ...state,
        histories: state.histories.filter(
          history => history.id !== action.payload
        )
      };

    case HistoryActionType.SET_PINNED_HISTORIES:
      return {
        ...state,
        pinnedHistories: action.payload
      };

    case HistoryActionType.SET_PINNED_LOADING_STATUS:
      return {
        ...state,
        pinnedLoadingStatus: action.payload
      };

    case HistoryActionType.SET_PINNED_OPEN:
      return {
        ...state,
        isPinnedOpen: action.payload
      };

    default:
      return state;
  }
};
