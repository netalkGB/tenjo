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
  getToolApprovalRules,
  getPreferences,
  updatePreferences,
  type Model
} from '@/api/server/settings';
import { getKnowledgeList, type Knowledge } from '@/api/server/knowledge';
import { type LocaleMode, LOCALE_MODES, changeLocale } from '@/i18n/config';
import { type ThemeMode, THEME_MODES, applyTheme } from '@/lib/themeManager';
import { useDialog } from '@/hooks/useDialog';

interface SettingsContextValue {
  models: Model[];
  activeModelId: string;
  isLoaded: boolean;
  setActiveModelId: (id: string) => void;
  reloadModels: () => Promise<void>;
  availableToolsByServer: Record<string, string[]>;
  mcpToolErrors: Record<string, string>;
  enabledTools: Set<string>;
  isToolsLoaded: boolean;
  toggleTool: (toolName: string) => void;
  toggleServerTools: (serverName: string) => void;
  enableAllTools: () => void;
  disableAllTools: () => void;
  reloadTools: (refetchMcpTools?: boolean) => Promise<void>;
  knowledgeList: Knowledge[];
  isKnowledgeLoaded: boolean;
  reloadKnowledge: () => Promise<void>;
  selectedKnowledge: Set<string>;
  toggleKnowledge: (id: string) => void;
  localeMode: LocaleMode;
  themeMode: ThemeMode;
  updateLocaleMode: (mode: LocaleMode) => void;
  updateThemeMode: (mode: ThemeMode) => void;
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
  const [mcpToolErrors, setMcpToolErrors] = useState<Record<string, string>>(
    {}
  );
  const [isToolsLoaded, setIsToolsLoaded] = useState(false);
  const [knowledgeList, setKnowledgeList] = useState<Knowledge[]>([]);
  const [isKnowledgeLoaded, setIsKnowledgeLoaded] = useState(false);
  const [selectedKnowledge, setSelectedKnowledge] = useState<Set<string>>(
    new Set()
  );
  const [localeMode, setLocaleMode] = useState<LocaleMode>('auto');
  const [themeMode, setThemeModeState] = useState<ThemeMode>('auto');

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

  const prefsInitialized = useRef(false);
  useEffect(() => {
    if (prefsInitialized.current) return;
    prefsInitialized.current = true;

    const loadPreferences = async () => {
      try {
        const prefs = await getPreferences();

        if (
          prefs.language &&
          LOCALE_MODES.includes(prefs.language as LocaleMode)
        ) {
          const mode = prefs.language as LocaleMode;
          changeLocale(mode);
          setLocaleMode(mode);
        }

        if (prefs.theme && THEME_MODES.includes(prefs.theme as ThemeMode)) {
          const mode = prefs.theme as ThemeMode;
          applyTheme(mode);
          setThemeModeState(mode);
        }

        if (
          prefs.selectedKnowledgeIds &&
          prefs.selectedKnowledgeIds.length > 0
        ) {
          setSelectedKnowledge(new Set(prefs.selectedKnowledgeIds));
        }
      } catch {
        // Preferences are non-critical; fall back to OS/browser defaults
      }
    };
    loadPreferences();
  });

  // Re-apply theme when OS preference changes (only relevant in auto mode)
  const themeModeRef = useRef(themeMode);
  themeModeRef.current = themeMode;
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (themeModeRef.current === 'auto') {
        applyTheme('auto');
      }
    };
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const cachedToolsResponse = useRef<Awaited<
    ReturnType<typeof getMcpTools>
  > | null>(null);

  const reloadTools = async (refetchMcpTools = false) => {
    try {
      const needsFetch = refetchMcpTools || !cachedToolsResponse.current;
      const [res, rulesRes, prefs] = await Promise.all([
        needsFetch
          ? getMcpTools()
          : Promise.resolve(cachedToolsResponse.current!),
        getToolApprovalRules(),
        getPreferences()
      ]);
      cachedToolsResponse.current = res;
      setMcpToolErrors(res.errors ?? {});

      // Filter out banned tools
      const bannedSet = new Set(
        rulesRes.rules.filter(r => r.approve === 'banned').map(r => r.toolName)
      );
      const filteredTools: Record<string, string[]> = {};
      for (const [server, tools] of Object.entries(res.tools)) {
        const filtered = tools.filter(t => !bannedSet.has(t));
        if (filtered.length > 0) {
          filteredTools[server] = filtered;
        }
      }

      setAvailableToolsByServer(filteredTools);
      const allTools = Object.values(filteredTools).flat();

      const disabled = prefs.disabledMcpTools;
      if (disabled && disabled.length > 0) {
        const disabledSet = new Set(disabled);
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

  const reloadKnowledge = async () => {
    try {
      const list = await getKnowledgeList();
      setKnowledgeList(list);

      // Remove selected IDs that no longer exist
      const validIds = new Set(list.map(k => k.id));
      setSelectedKnowledge(prev => {
        const next = new Set([...prev].filter(id => validIds.has(id)));
        if (next.size !== prev.size) {
          updatePreferences({ selectedKnowledgeIds: [...next] }).catch(
            () => {}
          );
        }
        return next;
      });
    } catch {
      // Knowledge is non-critical; silently fail
    } finally {
      setIsKnowledgeLoaded(true);
    }
  };

  const knowledgeInitialized = useRef(false);
  useEffect(() => {
    if (knowledgeInitialized.current) return;
    knowledgeInitialized.current = true;
    reloadKnowledge();
  });

  const persistDisabledTools = (
    enabled: Set<string>,
    allToolsByServer: Record<string, string[]>
  ) => {
    const allTools = Object.values(allToolsByServer).flat();
    const disabledMcpTools = allTools.filter(t => !enabled.has(t));
    updatePreferences({ disabledMcpTools }).catch(() => {
      openDialog({
        title: t('error'),
        description: t('error_save_preferences'),
        type: 'ok'
      });
    });
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

  const toggleKnowledge = (id: string) => {
    setSelectedKnowledge(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      updatePreferences({ selectedKnowledgeIds: [...next] }).catch(() => {
        openDialog({
          title: t('error'),
          description: t('error_save_preferences'),
          type: 'ok'
        });
      });
      return next;
    });
  };

  const updateLocaleMode = (mode: LocaleMode) => {
    changeLocale(mode);
    setLocaleMode(mode);
    updatePreferences({ language: mode }).catch(() => {
      openDialog({
        title: t('error'),
        description: t('error_save_preferences'),
        type: 'ok'
      });
    });
  };

  const updateThemeMode = (mode: ThemeMode) => {
    applyTheme(mode);
    setThemeModeState(mode);
    updatePreferences({ theme: mode }).catch(() => {
      openDialog({
        title: t('error'),
        description: t('error_save_preferences'),
        type: 'ok'
      });
    });
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
        mcpToolErrors,
        enabledTools,
        isToolsLoaded,
        toggleTool,
        toggleServerTools,
        enableAllTools,
        disableAllTools,
        reloadTools,
        knowledgeList,
        isKnowledgeLoaded,
        reloadKnowledge,
        selectedKnowledge,
        toggleKnowledge,
        localeMode,
        themeMode,
        updateLocaleMode,
        updateThemeMode
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
