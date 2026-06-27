import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useWebSearchToggle } from '@/hooks/useWebSearchToggle';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Web-search on/off toggle button used by the chat input. The state lives in
 * the settings context (persisted per user), so one toggle governs both the
 * chat and the agent surfaces.
 */
export function WebSearchToggle({ testId }: { testId: string }) {
  const { t } = useTranslation();
  const { webSearchEnabled, toggleWebSearch } = useWebSearchToggle();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          className="w-9 h-9 @sm:w-auto @sm:h-9 @sm:gap-1.5 cursor-pointer shrink-0 @max-sm:aria-pressed:bg-primary! @max-sm:aria-pressed:text-primary-foreground @max-sm:aria-pressed:border-primary! @max-sm:aria-pressed:hover:bg-primary/90!"
          onClick={toggleWebSearch}
          aria-pressed={webSearchEnabled}
          aria-label={t('web_search')}
          data-testid={testId}
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="text-xs hidden @sm:inline">
            {webSearchEnabled ? t('on') : t('off')}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('web_search')}</TooltipContent>
    </Tooltip>
  );
}
