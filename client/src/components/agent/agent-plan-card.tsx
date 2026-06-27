import { useState } from 'react';
import {
  CheckCircle2,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import type { AgentPlan, AgentPlanStatus, AgentPlanStep } from './types';

interface AgentPlanCardProps {
  plan: AgentPlan;
  onApprove?: () => void;
  onReject?: (feedback: string) => void;
  /**
   * The live, in-progress card (default). Set false for a frozen historical
   * snapshot flowed into the timeline at a past step completion — it suppresses
   * the "running" spinner/note so a finished task doesn't show a step spinning
   * forever when scrolled back.
   */
  live?: boolean;
}

// view: read-only plan, rejecting: the feedback textarea is open.
type PlanPhase = 'view' | 'rejecting';

function StepIndicator({
  status,
  index
}: {
  status: AgentPlanStep['status'];
  index: number;
}) {
  if (status === 'done') {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />;
  }
  if (status === 'running') {
    return (
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
    );
  }
  return (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground">
      {index + 1}
    </span>
  );
}

export function AgentPlanCard({
  plan,
  onApprove,
  onReject,
  live = true
}: AgentPlanCardProps) {
  const { t } = useTranslation();
  // Local UI phase only: whether the feedback textarea is open. The plan's
  // authoritative status comes from the `plan` prop (server-driven).
  const [phase, setPhase] = useState<PlanPhase>('view');
  const [feedback, setFeedback] = useState('');

  const cancelReject = () => {
    setPhase('view');
    setFeedback('');
  };

  const confirmReject = () => {
    onReject?.(feedback.trim());
    setPhase('view');
    setFeedback('');
  };

  const statusMeta: Record<
    AgentPlanStatus,
    { label: string; className: string }
  > = {
    proposed: {
      label: t('agent_plan_status_proposed'),
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    },
    running: {
      label: t('agent_plan_status_running'),
      className: 'bg-primary/15 text-primary'
    },
    done: {
      label: t('agent_plan_status_done'),
      className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    }
  };

  const meta = statusMeta[plan.status];

  return (
    <div
      className="my-2 overflow-hidden rounded-xl border bg-card"
      data-testid="agent-plan-card"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <ListChecks className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t('agent_plan_title')}</span>
        <Badge
          variant="ghost"
          className={`ml-auto border-transparent ${meta.className}`}
        >
          {meta.label}
        </Badge>
      </div>

      <ol className="divide-y">
        {plan.steps.map((step, index) => (
          <li key={step.id} className="flex gap-3 px-4 py-2.5">
            <StepIndicator status={step.status} index={index} />
            <div className="min-w-0">
              <div
                className={
                  step.status === 'done'
                    ? 'text-sm text-muted-foreground line-through'
                    : 'text-sm font-medium'
                }
              >
                {step.title}
              </div>
              {step.detail && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {step.detail}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {phase === 'rejecting' ? (
        <div className="space-y-2 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {t('agent_plan_reject_prompt_label')}
          </span>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder={t('agent_plan_reject_placeholder')}
            rows={2}
            className="w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="agent-plan-reject-input"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={cancelReject}
              data-testid="agent-plan-reject-cancel"
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={confirmReject}
              data-testid="agent-plan-reject-confirm"
            >
              <RotateCcw className="size-3.5" />
              {t('agent_plan_reject_confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            {plan.steps.length} {t('agent_plan_steps_suffix')}
          </span>
          {plan.status === 'proposed' ? (
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setPhase('rejecting')}
                data-testid="agent-plan-reject"
              >
                <X className="size-3.5" />
                {t('agent_plan_reject')}
              </Button>
              <Button
                size="sm"
                className="cursor-pointer"
                onClick={() => onApprove?.()}
                data-testid="agent-plan-approve"
              >
                <Play className="size-3.5" />
                {t('agent_plan_approve')}
              </Button>
            </div>
          ) : plan.status === 'running' && live ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="size-3.5 animate-spin" />
              {t('agent_plan_running_note')}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
