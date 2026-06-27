import { useState } from 'react';
import { Check, CircleHelp, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { AgentQuestionOption } from '@/contexts/agent-reducer';

interface AgentQuestionCardProps {
  question: string;
  /** Short category chip, if the model provided one. */
  header?: string;
  options: AgentQuestionOption[];
  /** Whether several options may be chosen at once. */
  multiSelect: boolean;
  /** Resolved view: the card is read-only and shows `answer` instead of inputs. */
  resolved?: boolean;
  /** The answer text, shown in the resolved view. */
  answer?: string;
  /** Submit the composed answer (chosen labels and/or the free-text input). */
  onSubmit?: (answer: string) => void;
}

/**
 * The agent's multiple-choice question, mirroring the assistant choice UI: a
 * question with clickable options (single- or multi-select) plus an always-
 * available free-text "other" answer. Blocks the turn until the user submits;
 * once answered it renders read-only with the chosen answer.
 */
export function AgentQuestionCard({
  question,
  header,
  options,
  multiSelect,
  resolved = false,
  answer,
  onSubmit
}: AgentQuestionCardProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  // With no concrete options the question is effectively free-text, so open the
  // input straight away — the user always has a way to answer (no dead card).
  const [otherActive, setOtherActive] = useState(options.length === 0);

  if (resolved) {
    return (
      <div
        className="my-1.5 rounded-md border border-border bg-muted/20"
        data-testid="agent-question-resolved"
      >
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <Check className="size-4 shrink-0 text-green-500" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {question}
          </span>
        </div>
        {answer && (
          <div className="border-t border-border px-3 py-2 text-sm font-medium">
            {answer}
          </div>
        )}
      </div>
    );
  }

  const toggle = (label: string) => {
    if (multiSelect) {
      setSelected(current =>
        current.includes(label)
          ? current.filter(item => item !== label)
          : [...current, label]
      );
      return;
    }
    // Single-select: picking an option replaces the choice and clears "other".
    setSelected(current => (current.includes(label) ? [] : [label]));
    setOtherActive(false);
  };

  const trimmedOther = otherText.trim();
  const parts = [...selected];
  if (otherActive && trimmedOther) {
    parts.push(trimmedOther);
  }
  const composed = parts.join(', ');
  const canSubmit = composed.length > 0;

  const handleSubmit = () => {
    if (canSubmit) {
      onSubmit?.(composed);
    }
  };

  return (
    <div
      className="my-1.5 rounded-md border border-primary/40 bg-primary/5"
      data-testid="agent-question-card"
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {header && (
            <span className="inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              {header}
            </span>
          )}
          <p className="text-sm font-medium">{question}</p>
          {multiSelect && (
            <p className="text-xs text-muted-foreground">
              {t('agent_question_multi_hint')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 px-3 pb-3">
        {options.map(option => {
          const active = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => toggle(option.label)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:bg-muted/50'
              )}
              data-testid="agent-question-option"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
                  multiSelect ? 'rounded-sm' : 'rounded-full',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40'
                )}
              >
                {active && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {/* Always-available free-text answer, like the assistant's "Other". */}
        <button
          type="button"
          onClick={() => setOtherActive(active => !active)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
            otherActive
              ? 'border-primary bg-primary/10'
              : 'border-border bg-background hover:bg-muted/50'
          )}
          data-testid="agent-question-other-toggle"
        >
          <Pencil className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{t('agent_question_other')}</span>
        </button>
        {otherActive && (
          <Textarea
            value={otherText}
            onChange={event => setOtherText(event.target.value)}
            placeholder={t('agent_question_other_placeholder')}
            className="min-h-16 text-sm"
            data-testid="agent-question-other-input"
          />
        )}

        <div className="pt-1">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="agent-question-submit"
          >
            {t('agent_question_submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
