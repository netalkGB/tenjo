import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Copy, RotateCw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface AssistantMessageActionsProps {
  isVisible?: boolean;
  onRetry?: () => void;
  onCopy?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  currentCount: number;
  totalCount: number;
}

export function AssistantMessageActions({
  isVisible = true,
  onRetry,
  onCopy,
  onPrevious,
  onNext,
  currentCount,
  totalCount
}: AssistantMessageActionsProps) {
  const { t } = useTranslation();
  const showPagination = !(currentCount === 1 && totalCount === 1);

  return (
    <div className={`flex ${isVisible ? 'visible' : 'invisible'}`}>
      <div className="flex pt-1 text-muted-foreground">
        <div className="mr-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={onRetry}
                data-testid="assistant-message-retry-button"
              >
                <RotateCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('retry')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="mr-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={onCopy}
                data-testid="assistant-message-copy-button"
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('copy')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        {showPagination && (
          <>
            <div className="mr-0.5">
              <Button
                variant="ghost"
                onClick={onPrevious}
                data-testid="assistant-message-branch-prev-button"
              >
                <ChevronLeft />
              </Button>
            </div>
            <div
              className="mr-0.5 flex items-center justify-center"
              data-testid="assistant-message-branch-count"
            >
              <p>
                {currentCount}/{totalCount}
              </p>
            </div>
            <div className="mr-0.5">
              <Button
                variant="ghost"
                onClick={onNext}
                data-testid="assistant-message-branch-next-button"
              >
                <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
