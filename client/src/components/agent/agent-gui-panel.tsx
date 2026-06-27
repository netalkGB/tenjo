import { type MouseEvent, useEffect, useState } from 'react';
import {
  Languages,
  Loader2,
  Maximize2,
  Monitor,
  Play,
  Square,
  TriangleAlert,
  Wrench,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { VncViewer } from '@/components/agent/vnc-viewer';
import { toggleAgentGuiIme } from '@/api/server/agent';
import { useAgent } from '@/contexts/agent-context';
import { useDialog } from '@/hooks/useDialog';
import { useTranslation } from '@/hooks/useTranslation';

export function AgentGuiPanel({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const { openDialog } = useDialog();
  const {
    state,
    submitting,
    openGuiPreview,
    stopGui,
    fixPreview,
    dismissPreviewError
  } = useAgent();
  const japaneseDesktopImeAvailable = i18n.locale === 'ja';

  const requestDesktopImeToggle = () => {
    void toggleAgentGuiIme(projectId).catch(() =>
      openDialog({
        title: t('error'),
        description: t('agent_gui_ime_error'),
        type: 'ok'
      })
    );
  };

  const keepVncCanvasFocused = (event: MouseEvent) => {
    event.preventDefault();
  };

  const keepExpandedDialogOpenForRemoteEscape = (event: KeyboardEvent) => {
    event.preventDefault();
  };

  const { status, detail } = state.guiStatus;
  const sandboxUnavailable = state.sandboxStatus.status === 'unavailable';
  const agentOwnsPreviewSession =
    state.status === 'running' ||
    state.streaming !== null ||
    submitting ||
    state.previewRepairActive;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (status !== 'running') {
      setExpanded(false);
    }
  }, [status]);

  const previewLaunchErrorNotice = state.previewLaunchError && (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-destructive">
          {t('agent_preview_launch_failed')}
        </p>
        <p className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
          {state.previewLaunchError}
        </p>
        <Button
          size="sm"
          className="mt-2"
          onClick={fixPreview}
          disabled={sandboxUnavailable || agentOwnsPreviewSession}
        >
          <Wrench className="size-3.5" />
          {t('agent_preview_fix')}
        </Button>
      </div>
      <button
        type="button"
        onClick={dismissPreviewError}
        aria-label={t('agent_preview_dismiss')}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );

  if (status === 'running') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {previewLaunchErrorNotice}
        <div className="flex items-center justify-between">
          <span
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="agent-gui-running"
          >
            <span className="size-2 rounded-full bg-emerald-500" />
            {t('agent_gui_running')}
          </span>
          <div className="flex items-center gap-1.5">
            {japaneseDesktopImeAvailable && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestDesktopImeToggle}
                onMouseDown={keepVncCanvasFocused}
                title={t('agent_gui_ime_hint')}
                disabled={agentOwnsPreviewSession}
                data-testid="agent-gui-ime"
              >
                <Languages className="size-4" />
                {t('agent_gui_ime')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(true)}
              disabled={agentOwnsPreviewSession}
              data-testid="agent-gui-expand"
            >
              <Maximize2 className="size-4" />
              {t('agent_gui_expand')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={stopGui}
              disabled={agentOwnsPreviewSession}
              data-testid="agent-gui-stop"
            >
              <Square className="size-4" />
              {t('agent_gui_stop')}
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {expanded ? (
            <div className="flex h-full items-center justify-center rounded-md border bg-background text-sm text-muted-foreground">
              {t('agent_gui_showing_expanded')}
            </div>
          ) : (
            <VncViewer projectId={projectId} />
          )}
          {agentOwnsPreviewSession && !expanded && (
            <GuiBusyOverlay label={t('agent_gui_busy')} />
          )}
        </div>
        <Dialog
          open={expanded}
          onOpenChange={open => !open && setExpanded(false)}
        >
          <DialogContent
            className="flex h-[min(94vh,100dvh-1rem)] w-[96vw] flex-col gap-0 p-0 sm:max-w-[96vw]"
            data-testid="agent-gui-expanded-dialog"
            aria-describedby={undefined}
            onEscapeKeyDown={keepExpandedDialogOpenForRemoteEscape}
          >
            <DialogHeader className="flex-row items-center gap-2 border-b px-4 py-2 pr-12">
              <DialogTitle className="text-sm font-medium">
                {t('agent_gui_tab')}
              </DialogTitle>
              {japaneseDesktopImeAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={requestDesktopImeToggle}
                  onMouseDown={keepVncCanvasFocused}
                  title={t('agent_gui_ime_hint')}
                  disabled={agentOwnsPreviewSession}
                >
                  <Languages className="size-4" />
                  {t('agent_gui_ime')}
                </Button>
              )}
            </DialogHeader>
            <div className="relative min-h-0 flex-1 p-2">
              {expanded && <VncViewer projectId={projectId} />}
              {agentOwnsPreviewSession && (
                <GuiBusyOverlay label={t('agent_gui_busy')} />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {previewLaunchErrorNotice}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        {agentOwnsPreviewSession ? (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t('agent_gui_busy')}
            </p>
          </>
        ) : status === 'starting' || status === 'stopping' ? (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {status === 'stopping'
                ? t('agent_gui_stopping')
                : t('agent_gui_starting')}
            </p>
          </>
        ) : (
          <>
            {status === 'error' ? (
              <>
                <TriangleAlert className="size-6 text-destructive" />
                <p className="text-sm text-destructive">
                  {t('agent_gui_error')}
                </p>
                {detail && (
                  <p className="max-w-full break-words text-xs text-muted-foreground">
                    {detail}
                  </p>
                )}
              </>
            ) : (
              <>
                <Monitor className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('agent_gui_description')}
                </p>
              </>
            )}
            <Button
              onClick={() => openGuiPreview()}
              disabled={sandboxUnavailable}
              data-testid="agent-gui-start"
            >
              <Play className="size-4" />
              {status === 'error' ? t('agent_gui_retry') : t('agent_gui_start')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function GuiBusyOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-background/70 backdrop-blur-[1px]">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="px-4 text-center text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
