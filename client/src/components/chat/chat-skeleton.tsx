import { Skeleton } from '@/components/ui/skeleton';
import { MainLayout } from '@/pages/main/layout';
import { UserMessageSection } from './user-message-section';
import { AssistantMessageSection } from './assistant-message-section';

export function ChatSkeleton() {
  return (
    <MainLayout
      header={<Skeleton className="h-5 w-54" />}
      content={
        <div>
          <div className="p-6 w-[85%] mx-auto">
            <UserMessageSection skeleton />
          </div>
          <div className="p-6 w-[85%] mx-auto">
            <AssistantMessageSection skeleton />
          </div>
        </div>
      }
      footer={
        <div className="bg-background">
          <div className="p-6 w-[85%] mx-auto">
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>
      }
    />
  );
}
