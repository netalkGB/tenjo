import { ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router';
import { usePreview } from '@/hooks/usePreview';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { HtmlPreviewPanel } from './html-preview-panel';

interface PreviewSplitProps {
  children: ReactNode;
}

export function PreviewSplit({ children }: PreviewSplitProps) {
  const { preview, closePreview } = usePreview();
  const location = useLocation();
  const isOpen = preview !== null;
  const { containerRef, percent, isDragging, separatorProps } =
    useResizableSplit({
      side: 'right',
      initialPercent: 50,
      minPercent: 25,
      maxPercent: 75
    });

  // Close the preview whenever the user navigates to a different page
  // (different thread, settings, home, etc.) so it doesn't linger out of context.
  useEffect(() => {
    closePreview();
  }, [location.pathname, closePreview]);

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 ${
        isDragging ? 'cursor-col-resize select-none' : ''
      }`}
    >
      <div className="flex-1 min-w-0 h-full">{children}</div>
      {isOpen && (
        <>
          <div
            {...separatorProps}
            className="hidden md:block w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors touch-none"
          />
          <aside
            className="hidden md:block shrink-0 h-full"
            style={{ width: `${percent}%` }}
          >
            <HtmlPreviewPanel />
          </aside>
          <div className="fixed inset-0 z-50 md:hidden">
            <HtmlPreviewPanel />
          </div>
        </>
      )}
    </div>
  );
}
