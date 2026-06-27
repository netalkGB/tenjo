import { Sidebar } from '@/components/sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { Outlet, useLoaderData, useNavigation } from 'react-router';
import { HistoryProvider } from '@/contexts/history-context';
import { AgentHistoryProvider } from '@/contexts/agent-history-context';
import { SettingsProvider } from '@/contexts/settings-context';
import { PreviewProvider } from '@/contexts/preview-context';
import { UserProvider, UserRole } from '@/contexts/user-context';
import { useHistory } from '@/hooks/useHistory';
import { useEffect, useRef } from 'react';
import { PreviewSplit } from '@/components/preview';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { preloadAgentHomeRoute } from '@/router/preloadRoutes';

function RouteLoadingIndicator() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const pathname = navigation.location?.pathname ?? '';

  if (navigation.state === 'idle') {
    return null;
  }

  const label = pathname.startsWith('/agent')
    ? t('agent_loading')
    : t('loading');

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function MainContent() {
  const { reload, reloadPinned } = useHistory();
  const hasFetched = useRef(false);
  const agentPreloadStarted = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    reload();
    reloadPinned();
  });

  useEffect(() => {
    if (agentPreloadStarted.current) return;
    agentPreloadStarted.current = true;

    const preloadTimer = window.setTimeout(() => {
      void preloadAgentHomeRoute();
    }, 800);

    return () => window.clearTimeout(preloadTimer);
  }, []);

  return (
    <PreviewProvider>
      <SidebarProvider>
        <Sidebar />
        <SidebarInset className="overflow-hidden">
          <RouteLoadingIndicator />
          <PreviewSplit>
            <Outlet />
          </PreviewSplit>
        </SidebarInset>
      </SidebarProvider>
    </PreviewProvider>
  );
}

export function Main() {
  const loaderData = useLoaderData() as {
    userName: string;
    userRole: UserRole;
    singleUserMode: boolean;
  };

  return (
    <UserProvider
      userName={loaderData.userName}
      userRole={loaderData.userRole}
      singleUserMode={loaderData.singleUserMode}
    >
      <HistoryProvider>
        <AgentHistoryProvider>
          <SettingsProvider>
            <MainContent />
          </SettingsProvider>
        </AgentHistoryProvider>
      </HistoryProvider>
    </UserProvider>
  );
}
