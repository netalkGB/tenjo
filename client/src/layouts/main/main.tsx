import { Sidebar } from '@/components/sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { Outlet, useLoaderData } from 'react-router';
import { HistoryProvider } from '@/contexts/history-context';
import { SettingsProvider } from '@/contexts/settings-context';
import { UserProvider, UserRole } from '@/contexts/user-context';
import { useHistory } from '@/hooks/useHistory';
import { useEffect, useRef } from 'react';

function MainContent() {
  const { reload, reloadPinned } = useHistory();
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    reload();
    reloadPinned();
  });

  return (
    <SidebarProvider>
      <Sidebar />
      <SidebarInset className="overflow-hidden">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
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
        <SettingsProvider>
          <MainContent />
        </SettingsProvider>
      </HistoryProvider>
    </UserProvider>
  );
}
