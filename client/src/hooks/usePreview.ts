import { useContext } from 'react';
import { PreviewContext } from '@/contexts/preview-context';

export function usePreview() {
  const context = useContext(PreviewContext);
  if (context === undefined) {
    throw new Error('usePreview must be used within a PreviewProvider');
  }
  return context;
}
