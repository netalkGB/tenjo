import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

export type SidebarMode = 'chat' | 'agent';

const STORAGE_KEY = 'sidebar-mode';

/**
 * The sidebar mode is "sticky": it follows the route when the route clearly
 * belongs to chat or agent, but neutral routes (settings, knowledge, …) keep
 * whichever mode was last active instead of snapping back to chat. The value is
 * held in a tiny external store so every sidebar consumer stays in sync.
 */
function modeForPath(pathname: string): SidebarMode | null {
  if (pathname === '/agent' || pathname.startsWith('/agent/')) return 'agent';
  if (pathname === '/' || pathname === '/chat' || pathname.startsWith('/chat/'))
    return 'chat';
  return null;
}

function readStoredMode(): SidebarMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'agent' ? 'agent' : 'chat';
  } catch {
    return 'chat';
  }
}

let currentMode: SidebarMode = 'chat';
let initialized = false;
const listeners = new Set<() => void>();

function setMode(mode: SidebarMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode); in-memory state still works.
  }

  if (mode === currentMode) return;
  currentMode = mode;
  listeners.forEach(listener => listener());
}

function syncModeForPath(pathname: string) {
  const implied = modeForPath(pathname);
  if (implied) {
    initialized = true;
    setMode(implied);
    return;
  }

  if (initialized) return;
  initialized = true;
  setMode(readStoredMode());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentMode;
}

export function useSidebarMode(): SidebarMode {
  const { pathname } = useLocation();
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useLayoutEffect(() => {
    syncModeForPath(pathname);
  }, [pathname]);

  return mode;
}
