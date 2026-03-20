import { ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface MainLayoutProps {
  header: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
}

export function MainLayout({ header, content, footer }: MainLayoutProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        {header}
      </header>
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="flex-1 overflow-y-auto">{content}</div>
        {footer}
      </div>
    </div>
  );
}
