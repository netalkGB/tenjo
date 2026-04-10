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
              <Button
                variant="ghost"
                onClick={onRetry}
                data-testid="user-message-retry-button"
              >
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
              <Button
                variant="ghost"
                onClick={onEdit}
                data-testid="user-message-edit-button"
              >
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
              <Button
                variant="ghost"
                onClick={onCopy}
                data-testid="user-message-copy-button"
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
            <div className="ml-0.5">
              <Button
                variant="ghost"
                onClick={onPrevious}
                data-testid="user-message-branch-prev-button"
              >
                <ChevronLeft />
              </Button>
            </div>
            <div
              className="ml-0.5 flex items-center justify-center"
              data-testid="user-message-branch-count"
            >
              <p>
                {currentCount}/{totalCount}
              </p>
            </div>
            <div className="ml-0.5">
              <Button
                variant="ghost"
                onClick={onNext}
                data-testid="user-message-branch-next-button"
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
