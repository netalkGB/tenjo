import { ChevronRight, Pin } from 'lucide-react';
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

export function PinnedSection() {
  const { t } = useTranslation();
  const { pinnedHistories, isPinnedOpen, setPinnedOpen, pinnedLoadingStatus } =
    useHistory();

  // Do not display if loading is complete and there are no items
  if (pinnedLoadingStatus !== 'loading' && pinnedHistories.length === 0) {
    return null;
  }

  return (
    <Collapsible
      className="group/pinned"
      open={isPinnedOpen}
      onOpenChange={isOpen => setPinnedOpen(isOpen)}
    >
      <SidebarMenuItem className="relative">
        <SidebarMenuButton>
          <Pin className="size-4" />
          <span>{t('pinned')}</span>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <button
            className="absolute right-0 top-0 bottom-0 w-8 hover:bg-accent rounded-md flex items-center justify-center"
            onClick={e => e.stopPropagation()}
          >
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/pinned:rotate-90" />
          </button>
        </CollapsibleTrigger>
      </SidebarMenuItem>
      <CollapsibleContent>
        <SidebarMenuSub>
          {pinnedLoadingStatus === 'loading'
            ? Array.from({ length: 3 }).map((_, index) => (
                <ChatHistoryItem key={index} skeleton />
              ))
            : pinnedHistories.map(item => (
                <ChatHistoryItem
                  key={item.id}
                  title={item.title === '' ? '-' : item.title}
                  id={item.id}
                  pinned
                />
              ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}
