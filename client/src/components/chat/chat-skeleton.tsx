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
          <div className="px-4 py-4 w-full mx-auto md:p-6 md:w-[85%]">
            <UserMessageSection skeleton />
          </div>
          <div className="px-4 py-4 w-full mx-auto md:p-6 md:w-[85%]">
            <AssistantMessageSection skeleton />
          </div>
        </div>
      }
      footer={
        <div className="bg-background">
          <div className="px-4 py-4 w-full mx-auto md:p-6 md:w-[85%]">
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>
      }
    />
  );
}
