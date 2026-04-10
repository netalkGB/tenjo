import { Link } from 'react-router';
import ServiceLogo from '@/assets/service-logo.svg?react';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';

export function SidebarLogo() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md p-1 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          data-testid="sidebar-logo-link"
        >
          <ServiceLogo className="h-7 w-auto" />
        </Link>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
