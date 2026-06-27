import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { MainLayout } from '../layout';
import { AgentPromptInput } from '@/components/agent/agent-prompt-input';
import { AgentSandboxBanner } from '@/components/agent/agent-sandbox-banner';
import { PromptMarquee } from '@/components/agent/prompt-marquee';
import { BrandLogo } from '@/components/common/brand-logo';
import { useTranslation } from '@/hooks/useTranslation';
import { useDialog } from '@/hooks/useDialog';
import { useSettings } from '@/contexts/settings-context';
import { createAgentProject, fetchSandboxStatus } from '@/api/server/agent';
import type { SandboxStatus } from '@/contexts/agent-reducer';
import type { AgentMode } from '@/components/agent/types';
import type { ContextFileRef } from '@/api/server/agent';

export function AgentHome() {
  const { t } = useTranslation();
  const { openDialog } = useDialog();
  const navigate = useNavigate();
  const { activeModelId } = useSettings();
  // The mode chosen here must follow the task into its first turn — otherwise a
  // steer-mode task would silently run its first turn in plan mode and present
  // a plan the user never asked for. Persist it at creation AND hand it to the
  // task page for the initial submit.
  const [mode, setMode] = useState<AgentMode>('plan');
  // Shared-sandbox status, fetched once so a slow first run / unavailable Docker
  // is shown here too (the task page learns it live over SSE). SSE is per-project
  // and there is no project yet, so this is a plain one-shot REST fetch.
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>({
    status: 'unknown'
  });
  const statusFetched = useRef(false);
  const loadSandboxStatus = () => {
    fetchSandboxStatus()
      .then(setSandboxStatus)
      .catch(() => {});
  };
  useEffect(() => {
    if (statusFetched.current) return;
    statusFetched.current = true;
    loadSandboxStatus();
  });

  const handleSubmit = async (
    prompt: string,
    files: File[],
    contextFiles: ContextFileRef[],
    knowledgeIds: string[]
  ) => {
    try {
      const projectId = await createAgentProject({
        mode,
        modelId: activeModelId || undefined
      });
      // Preview thumbnails for attached images, so the task page's first-turn
      // bubble shows them the instant it loads (the Files themselves don't
      // survive the navigation — only these object URLs and the uploaded refs).
      // The URLs stay valid across this client-side navigation (same document).
      const imagePreviews = files
        .filter(file => file.type.startsWith('image/'))
        .map(file => URL.createObjectURL(file));
      navigate(`/agent/task/${projectId}`, {
        state: {
          initialPrompt: prompt,
          initialMode: mode,
          initialContextFiles:
            contextFiles.length > 0 ? contextFiles : undefined,
          initialKnowledgeIds:
            knowledgeIds.length > 0 ? knowledgeIds : undefined,
          initialImagePreviews:
            imagePreviews.length > 0 ? imagePreviews : undefined
        }
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message !== 'API Error'
          ? `${t('agent_create_failed')}\n${error.message}`
          : t('agent_create_failed');
      openDialog({
        title: t('error'),
        description: detail,
        type: 'ok'
      });
    }
  };

  return (
    <MainLayout
      header={
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('mode_agent')}</span>
        </div>
      }
      content={
        <div className="h-full w-full px-4 py-4">
          <div className="relative top-[calc(15%)]">
            <div className="flex flex-col items-center justify-center">
              <div className="relative">
                <BrandLogo className="h-25 w-auto" />
                <span className="absolute -bottom-1 -right-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                  {t('mode_agent')}
                </span>
              </div>
              <div className="mt-5 w-[90%] sm:w-full max-w-185">
                {(sandboxStatus.status === 'preparing' ||
                  sandboxStatus.status === 'unavailable') && (
                  <div className="mb-2">
                    <AgentSandboxBanner sandboxStatus={sandboxStatus} />
                  </div>
                )}
                <AgentPromptInput
                  onSubmit={handleSubmit}
                  mode={mode}
                  onModeChange={setMode}
                  disabled={sandboxStatus.status === 'unavailable'}
                  disabledHint={t('agent_sandbox_unavailable_description')}
                />
              </div>
              <div className="mt-6 w-full max-w-185">
                <PromptMarquee />
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}
