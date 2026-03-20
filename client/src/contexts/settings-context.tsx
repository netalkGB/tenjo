import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode
} from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getModels,
  setActiveModel as setActiveModelApi,
  getMcpTools,
  type Model
} from '@/api/server/settings';
import { useDialog } from '@/hooks/useDialog';
import { McpToolStorage } from '@/lib/McpToolStorage';

interface SettingsContextValue {
  models: Model[];
  activeModelId: string;
  isLoaded: boolean;
  setActiveModelId: (id: string) => void;
  reloadModels: () => Promise<void>;
  availableToolsByServer: Record<string, string[]>;
  enabledTools: Set<string>;
  isToolsLoaded: boolean;
  toggleTool: (toolName: string) => void;
  toggleServerTools: (serverName: string) => void;
  enableAllTools: () => void;
  disableAllTools: () => void;
  reloadTools: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { openDialog } = useDialog();
  const [models, setModels] = useState<Model[]>([]);
  const [activeModelId, setActiveModelIdState] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [availableToolsByServer, setAvailableToolsByServer] = useState<
    Record<string, string[]>
  >({});
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [isToolsLoaded, setIsToolsLoaded] = useState(false);

  const reloadModels = async () => {
    try {
      const data = await getModels();
      setModels(data.models);
      setActiveModelIdState(data.activeId);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_models'),
        type: 'ok'
      });
    } finally {
      setIsLoaded(true);
    }
  };

  const modelsInitialized = useRef(false);
  useEffect(() => {
    if (modelsInitialized.current) return;
    modelsInitialized.current = true;
    reloadModels();
  });

  const reloadTools = async () => {
    try {
      const res = await getMcpTools();
      setAvailableToolsByServer(res.tools);
      const allTools = Object.values(res.tools).flat();

      const disabledSet = McpToolStorage.load(allTools);
      if (disabledSet) {
        setEnabledTools(new Set(allTools.filter(t => !disabledSet.has(t))));
      } else {
        setEnabledTools(new Set(allTools));
      }
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_mcp_tools'),
        type: 'ok'
      });
    } finally {
      setIsToolsLoaded(true);
    }
  };

  const toolsInitialized = useRef(false);
  useEffect(() => {
    if (toolsInitialized.current) return;
    toolsInitialized.current = true;
    reloadTools();
  });

  const persistDisabledTools = (
    enabled: Set<string>,
    allToolsByServer: Record<string, string[]>
  ) => {
    const allTools = Object.values(allToolsByServer).flat();
    McpToolStorage.save(enabled, allTools);
  };

  const toggleTool = (toolName: string) => {
    setEnabledTools(prev => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      persistDisabledTools(next, availableToolsByServer);
      return next;
    });
  };

  const toggleServerTools = (serverName: string) => {
    const serverTools = availableToolsByServer[serverName] ?? [];
    if (serverTools.length === 0) return;

    setEnabledTools(prev => {
      const allEnabled = serverTools.every(t => prev.has(t));
      const next = new Set(prev);
      if (allEnabled) {
        for (const t of serverTools) next.delete(t);
      } else {
        for (const t of serverTools) next.add(t);
      }
      persistDisabledTools(next, availableToolsByServer);
      return next;
    });
  };

  const enableAllTools = () => {
    const allTools = Object.values(availableToolsByServer).flat();
    const next = new Set(allTools);
    setEnabledTools(next);
    persistDisabledTools(next, availableToolsByServer);
  };

  const disableAllTools = () => {
    setEnabledTools(new Set());
    persistDisabledTools(new Set(), availableToolsByServer);
  };

  const setActiveModelId = (id: string) => {
    setActiveModelIdState(id);
    setActiveModelApi(id).catch(() => {
      openDialog({
        title: t('error'),
        description: t('error_set_active_model'),
        type: 'ok'
      });
    });
  };

  return (
    <SettingsContext.Provider
      value={{
        models,
        activeModelId,
        isLoaded,
        setActiveModelId,
        reloadModels,
        availableToolsByServer,
        enabledTools,
        isToolsLoaded,
        toggleTool,
        toggleServerTools,
        enableAllTools,
        disableAllTools,
        reloadTools
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}
