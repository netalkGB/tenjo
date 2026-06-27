import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  listAgentProjects,
  patchAgentProject,
  deleteAgentProject,
  type AgentProjectDto
} from '@/api/server/agent';

interface AgentHistoryContextValue {
  projects: AgentProjectDto[];
  pinned: AgentProjectDto[];
  isLoaded: boolean;
  reload: () => Promise<void>;
  renameProject: (id: string, title: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

const AgentHistoryContext = createContext<AgentHistoryContextValue | null>(
  null
);

export function AgentHistoryProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<AgentProjectDto[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Mirror the chat sidebar: show only the first page (10 most recent).
  const reload = async () => {
    try {
      const response = await listAgentProjects({ page: 1, pageSize: 10 });
      setProjects(response.projects);
    } catch {
      // Non-critical: the sidebar list just stays empty on failure.
    } finally {
      setIsLoaded(true);
    }
  };

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    reload();
  });

  const renameProject = async (id: string, title: string) => {
    const updated = await patchAgentProject(id, { title });
    setProjects(prev => prev.map(p => (p.id === id ? updated : p)));
  };

  const togglePin = async (id: string, pinned: boolean) => {
    const updated = await patchAgentProject(id, { pinned });
    setProjects(prev => prev.map(p => (p.id === id ? updated : p)));
  };

  const deleteProject = async (id: string) => {
    await deleteAgentProject(id);
    // Reload so the first-page window refills, mirroring the chat sidebar.
    await reload();
  };

  const pinned = projects.filter(p => p.pinned);

  return (
    <AgentHistoryContext.Provider
      value={{
        projects,
        pinned,
        isLoaded,
        reload,
        renameProject,
        togglePin,
        deleteProject
      }}
    >
      {children}
    </AgentHistoryContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAgentHistory(): AgentHistoryContextValue {
  const context = useContext(AgentHistoryContext);
  if (!context) {
    throw new Error('useAgentHistory must be used within AgentHistoryProvider');
  }
  return context;
}
