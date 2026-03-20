import { createContext, useContext, useReducer, ReactNode } from 'react';
import { historyReducer, initialHistoryState } from '../state/historyReducer';
import type { HistoryState, HistoryAction } from '../state/types';

interface HistoryContextValue {
  state: HistoryState;
  dispatch: React.Dispatch<HistoryAction>;
}
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, initialHistoryState);

  const value = { state, dispatch };

  return (
    <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHistoryContext() {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistoryContext must be used within HistoryProvider');
  }
  return context;
}
