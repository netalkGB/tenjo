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
              <Button variant="ghost" onClick={onRetry}>
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
              <Button variant="ghost" onClick={onCopy}>
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
              <Button variant="ghost" onClick={onPrevious}>
                <ChevronLeft />
              </Button>
            </div>
            <div className="mr-0.5 flex items-center justify-center">
              <p>
                {currentCount}/{totalCount}
              </p>
            </div>
            <div className="mr-0.5">
              <Button variant="ghost" onClick={onNext}>
                <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
