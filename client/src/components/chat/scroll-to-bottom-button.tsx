import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface ScrollToBottomButtonProps {
  onClick: () => void;
  className?: string;
}

export function ScrollToBottomButton({
  onClick,
  className
}: ScrollToBottomButtonProps) {
  const { t } = useTranslation();
  const label = t('scroll_to_bottom');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClick}
          aria-label={label}
          data-testid="scroll-to-bottom-button"
          className={cn('rounded-full shadow-md', className)}
        >
          <ArrowDown />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
