import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentVncUrl, toggleAgentGuiIme } from '@/api/server/agent';
import { useTranslation } from '@/hooks/useTranslation';

type ViewerState = 'connecting' | 'connected' | 'disconnected';

const XK_CONTROL_L = 0xffe3;
const XK_V = 0x0076;
const REMOTE_PASTE_DELAY_MS = 25;

export function VncViewer({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const [viewerState, setViewerState] = useState<ViewerState>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (i18n.locale !== 'ja') {
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        void toggleAgentGuiIme(projectId).catch(() => undefined);
      }
    };
    container.addEventListener('keydown', handleKeyDown, true);
    return () => container.removeEventListener('keydown', handleKeyDown, true);
  }, [projectId, i18n]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setViewerState('connecting');
    const rfb = new RFB(container, agentVncUrl(projectId));
    // noVNC has no public switch for this; keep remote typing layout-agnostic.
    Object.defineProperty(rfb, '_qemuExtKeyEventSupported', {
      get: () => false,
      set: () => undefined
    });
    rfb.resizeSession = true;
    rfb.scaleViewport = true;
    rfb.qualityLevel = 9;
    const handleConnect = () => setViewerState('connected');
    const handleDisconnect = () => setViewerState('disconnected');
    rfb.addEventListener('connect', handleConnect);
    rfb.addEventListener('disconnect', handleDisconnect);

    let remoteClipboardText = '';
    const handleClipboard = (event: Event) => {
      remoteClipboardText = (event as CustomEvent<{ text: string }>).detail
        .text;
    };
    const sendRemotePasteShortcut = () => {
      rfb.focus({ preventScroll: true });
      rfb.sendKey(XK_CONTROL_L, 'ControlLeft', true);
      rfb.sendKey(XK_V, 'KeyV', true);
      rfb.sendKey(XK_V, 'KeyV', false);
      rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false);
    };
    const syncTextAndPasteToRemote = (text: string) => {
      if (!text) {
        return;
      }
      rfb.clipboardPasteFrom(text);
      window.setTimeout(sendRemotePasteShortcut, REMOTE_PASTE_DELAY_MS);
    };
    const pushToRemote = () => {
      const read = navigator.clipboard?.readText?.();
      if (!read) {
        return;
      }
      const remoteHadFocus = container.contains(document.activeElement);
      void read
        .then(text => {
          if (text) {
            rfb.clipboardPasteFrom(text);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (remoteHadFocus) {
            rfb.focus({ preventScroll: true });
          }
        });
    };
    const activeElementBelongsToViewer = () => {
      const activeElement = document.activeElement;
      return (
        container.contains(activeElement) ||
        (pointerInsideRef.current &&
          (activeElement === null ||
            activeElement === document.body ||
            activeElement === document.documentElement))
      );
    };
    const isPasteShortcut = (event: KeyboardEvent) =>
      ((event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.code === 'KeyV') ||
      (event.shiftKey && !event.ctrlKey && event.code === 'Insert');
    const handlePasteShortcutKeyDown = (event: KeyboardEvent) => {
      if (!activeElementBelongsToViewer() || !isPasteShortcut(event)) {
        return;
      }
      let read: Promise<string> | undefined;
      try {
        read = navigator.clipboard?.readText?.();
      } catch {
        return;
      }
      if (!read) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void read
        .then(syncTextAndPasteToRemote)
        .catch(() => undefined)
        .finally(() => rfb.focus({ preventScroll: true }));
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (!activeElementBelongsToViewer()) {
        return;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      syncTextAndPasteToRemote(text);
    };
    const pullToLocal = () => {
      if (remoteClipboardText) {
        void navigator.clipboard
          ?.writeText(remoteClipboardText)
          .catch(() => undefined);
      }
    };
    const handleMouseEnter = () => {
      pointerInsideRef.current = true;
      pushToRemote();
    };
    const handleMouseLeave = () => {
      pointerInsideRef.current = false;
      pullToLocal();
    };
    rfb.addEventListener('clipboard', handleClipboard);
    document.addEventListener('keydown', handlePasteShortcutKeyDown, true);
    document.addEventListener('paste', handlePaste, true);
    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      rfb.removeEventListener('connect', handleConnect);
      rfb.removeEventListener('disconnect', handleDisconnect);
      rfb.removeEventListener('clipboard', handleClipboard);
      document.removeEventListener('keydown', handlePasteShortcutKeyDown, true);
      document.removeEventListener('paste', handlePaste, true);
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
      try {
        rfb.disconnect();
      } catch {
        return;
      }
    };
  }, [projectId, reconnectAttempt]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-md border bg-background">
      <div ref={containerRef} className="absolute inset-0" />
      {viewerState !== 'connected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          {viewerState === 'connecting' ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              <span>{t('agent_gui_connecting')}</span>
            </>
          ) : (
            <>
              <span>{t('agent_gui_disconnected')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReconnectAttempt(reconnectAttempt + 1)}
              >
                <RotateCw className="size-4" />
                {t('agent_gui_reconnect')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
