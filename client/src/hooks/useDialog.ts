import { useContext } from 'react';
import { DialogContext } from '@/contexts/dialog-context';

export function useDialog() {
  const context = useContext(DialogContext);
  if (context === undefined) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
