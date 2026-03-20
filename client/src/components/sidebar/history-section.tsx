import { ChevronRight, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@radix-ui/react-collapsible';
import { ChatHistoryItem } from './chat-history-item';
import { useHistory } from '@/hooks/useHistory';

interface HistorySectionProps {
  skeletonCount?: number;
}

export function HistorySection({ skeletonCount = 10 }: HistorySectionProps) {
  const { t } = useTranslation();
  const { histories, isOpen, setOpen, loadingStatus } = useHistory();

  return (
    <Collapsible
      className="group/collapsible"
      open={isOpen}
      onOpenChange={isOpen => setOpen(isOpen)}
    >
      <SidebarMenuItem className="relative">
        <SidebarMenuButton asChild>
          <Link to="/history">
            <MessageSquare />
            <span>{t('history')}</span>
          </Link>
        </SidebarMenuButton>
        {/* Separate collapse trigger button - positioned absolutely to overlay the chevron area */}
        <CollapsibleTrigger asChild>
          <button
            className="absolute right-0 top-0 bottom-0 w-8 hover:bg-accent rounded-md flex items-center justify-center"
            onClick={e => e.stopPropagation()}
          >
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </button>
        </CollapsibleTrigger>
      </SidebarMenuItem>
      <CollapsibleContent>
        <SidebarMenuSub>
          {/* Chat history items with truncated titles and context menu */}
          {loadingStatus === 'loading'
            ? Array.from({ length: skeletonCount }).map((_, index) => (
                <ChatHistoryItem key={index} skeleton />
              ))
            : histories.map((item, _index) => (
                <ChatHistoryItem
                  key={item.id}
                  title={item.title === '' ? '-' : item.title}
                  id={item.id}
                  pinned={item.pinned}
                />
              ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}
