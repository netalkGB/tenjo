import { Button } from '@/components/ui/button';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RotateCw
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface UserMessageActionsProps {
  isVisible?: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
  onCopy?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  currentCount: number;
  totalCount: number;
}

export function UserMessageActions({
  isVisible = true,
  onRetry,
  onEdit,
  onCopy,
  onPrevious,
  onNext,
  currentCount,
  totalCount
}: UserMessageActionsProps) {
  const { t } = useTranslation();
  const showPagination = !(currentCount === 1 && totalCount === 1);

  return (
    <div
      className={`flex justify-end transition-opacity ${isVisible ? 'opacity-0 group-hover:opacity-100' : 'invisible'}`}
    >
      <div className="flex pt-1 text-muted-foreground">
        <div className="ml-0.5">
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
        <div className="ml-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" onClick={onEdit}>
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('edit')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="ml-0.5">
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
            <div className="ml-0.5">
              <Button variant="ghost" onClick={onPrevious}>
                <ChevronLeft />
              </Button>
            </div>
            <div className="ml-0.5 flex items-center justify-center">
              <p>
                {currentCount}/{totalCount}
              </p>
            </div>
            <div className="ml-0.5">
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
