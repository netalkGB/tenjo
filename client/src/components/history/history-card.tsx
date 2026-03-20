import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash, Pencil, Pin, PinOff } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';

interface HistoryCardProps {
  title?: string;
  date?: string;
  pinned?: boolean;
  onDelete?: (event: React.MouseEvent) => void;
  onRename?: (event: React.MouseEvent) => void;
  onTogglePin?: (event: React.MouseEvent) => void;
  skeleton?: boolean;
}

export function HistoryCard({
  title,
  date,
  pinned = false,
  onDelete,
  onRename,
  onTogglePin,
  skeleton = false
}: HistoryCardProps) {
  const { t } = useTranslation();

  if (skeleton) {
    return (
      <Card className="px-4 py-3 mb-0 border-x-0 border-t-0 last:border-b-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4.75 w-3/5" />
          <Skeleton className="h-4 w-24" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="px-4 py-3 mb-0 border-x-0 border-t-0 last:border-b-0 hover:bg-accent cursor-pointer group">
      <div className="flex items-center justify-between relative">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-sm text-muted-foreground block group-hover:invisible">
          {date}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto absolute right-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="cursor-pointer h-5 w-5 p-0 hover:bg-slate-200 dark:hover:bg-slate-700 items-center justify-center shrink-0"
                onClick={onTogglePin}
              >
                {pinned ? (
                  <PinOff className="w-3.5 h-3.5" />
                ) : (
                  <Pin className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{pinned ? t('unpin') : t('pin')}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="cursor-pointer h-5 w-5 p-0 hover:bg-slate-200 dark:hover:bg-slate-700 items-center justify-center shrink-0"
                onClick={onRename}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('rename')}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="cursor-pointer h-5 w-5 p-0 hover:bg-slate-200 dark:hover:bg-slate-700 items-center justify-center shrink-0"
                onClick={onDelete}
              >
                <Trash className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('delete')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}
