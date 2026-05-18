import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { usePreview } from '@/hooks/usePreview';
import { HtmlPreviewPanel } from './html-preview-panel';

interface PreviewSplitProps {
  children: ReactNode;
}

const DEFAULT_PREVIEW_PERCENT = 50;
const MIN_PREVIEW_PERCENT = 25;
const MAX_PREVIEW_PERCENT = 75;

export function PreviewSplit({ children }: PreviewSplitProps) {
  const { preview, closePreview } = usePreview();
  const location = useLocation();
  const isOpen = preview !== null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewPercent, setPreviewPercent] = useState(DEFAULT_PREVIEW_PERCENT);
  const [isDragging, setIsDragging] = useState(false);

  // Close the preview whenever the user navigates to a different page
  // (different thread, settings, home, etc.) so it doesn't linger out of context.
  useEffect(() => {
    closePreview();
  }, [location.pathname, closePreview]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Capture the pointer on the separator itself so subsequent move/up events
    // are delivered to it even when the cursor passes over the iframe (which
    // would otherwise swallow them).
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const distanceFromRight = rect.right - event.clientX;
    const percent = (distanceFromRight / rect.width) * 100;
    setPreviewPercent(
      Math.min(MAX_PREVIEW_PERCENT, Math.max(MIN_PREVIEW_PERCENT, percent))
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  };

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
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(previewPercent)}
            aria-valuemin={MIN_PREVIEW_PERCENT}
            aria-valuemax={MAX_PREVIEW_PERCENT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="hidden md:block w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors touch-none"
          />
          <aside
            className="hidden md:block shrink-0 h-full"
            style={{ width: `${previewPercent}%` }}
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
