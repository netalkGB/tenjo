import * as React from 'react';

type ResizeSide = 'left' | 'right';

interface UseResizableSplitOptions {
  /**
   * Which side of the container the controlled panel is anchored to.
   * `percent` then represents that panel's width as a percentage.
   */
  side: ResizeSide;
  initialPercent?: number;
  minPercent?: number;
  maxPercent?: number;
}

interface UseResizableSplitResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  percent: number;
  isDragging: boolean;
  separatorProps: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * Pointer-capture based horizontal resizer for a two-pane split. The separator
 * keeps receiving move/up events even when the cursor passes over child content
 * (for example an iframe) that would otherwise swallow them.
 */
export function useResizableSplit({
  side,
  initialPercent = 50,
  minPercent = 20,
  maxPercent = 80
}: UseResizableSplitOptions): UseResizableSplitResult {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [percent, setPercent] = React.useState(initialPercent);
  const [isDragging, setIsDragging] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const distance =
      side === 'right' ? rect.right - event.clientX : event.clientX - rect.left;
    const next = (distance / rect.width) * 100;
    setPercent(Math.min(maxPercent, Math.max(minPercent, next)));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  };

  const separatorProps: React.HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': Math.round(percent),
    'aria-valuemin': minPercent,
    'aria-valuemax': maxPercent,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp
  };

  return { containerRef, percent, isDragging, separatorProps };
}
