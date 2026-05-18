import { createContext, useState, ReactNode } from 'react';

/* eslint-disable react-refresh/only-export-components */

export interface PreviewState {
  content: string;
  title: string;
  sourceMessageId: string | null;
}

interface OpenPreviewArgs {
  content: string;
  title?: string;
  sourceMessageId?: string | null;
}

interface PreviewContextType {
  preview: PreviewState | null;
  openPreview: (args: OpenPreviewArgs) => void;
  closePreview: () => void;
}

export const PreviewContext = createContext<PreviewContextType | undefined>(
  undefined
);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const openPreview = ({
    content,
    title = 'HTML Preview',
    sourceMessageId = null
  }: OpenPreviewArgs) => {
    setPreview({ content, title, sourceMessageId });
  };

  const closePreview = () => {
    setPreview(null);
  };

  return (
    <PreviewContext.Provider
      value={{
        preview,
        openPreview,
        closePreview
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}
