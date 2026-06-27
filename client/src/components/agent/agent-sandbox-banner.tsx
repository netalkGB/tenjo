import { Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { SandboxStatus } from '@/contexts/agent-reducer';

/**
 * Non-blocking notice explaining the shared Docker sandbox lifecycle, so a slow
 * first run (building images can take minutes) reads as expected progress rather
 * than a silent spinner. Renders nothing while ready/unknown.
 */
export function AgentSandboxBanner({
  sandboxStatus
}: {
  sandboxStatus: SandboxStatus;
}) {
  const { t } = useTranslation();
  const { status, detail } = sandboxStatus;

  if (status === 'preparing') {
    return (
      <div
        className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
        role="status"
        data-testid="agent-sandbox-banner-preparing"
      >
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {t('agent_sandbox_preparing_title')}
          </p>
          <p className="text-xs opacity-90">
            {t('agent_sandbox_preparing_description')}
          </p>
          {detail && (
            <p className="truncate font-mono text-xs opacity-70" title={detail}>
              {detail}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-md border border-destructive/40',
          'bg-destructive/10 px-3 py-2.5 text-destructive'
        )}
        role="alert"
        data-testid="agent-sandbox-banner-unavailable"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {t('agent_sandbox_unavailable_title')}
          </p>
          <p className="text-xs opacity-90">
            {t('agent_sandbox_unavailable_description')}
          </p>
          {detail && (
            <p className="truncate font-mono text-xs opacity-70" title={detail}>
              {detail}
            </p>
          )}
        </div>
      </div>
    );
  }

  return null;
}
