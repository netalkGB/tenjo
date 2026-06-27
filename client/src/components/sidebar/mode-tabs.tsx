import { Loader2, MessageCircle, Sparkles } from 'lucide-react';
import { useNavigate, useNavigation } from 'react-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSidebarMode } from '@/hooks/useSidebarMode';
import { useTranslation } from '@/hooks/useTranslation';
import { preloadAgentHomeRoute } from '@/router/preloadRoutes';

export function ModeTabs() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const mode = useSidebarMode();
  const { t } = useTranslation();
  const isAgentLoading =
    navigation.state !== 'idle' &&
    (navigation.location?.pathname.startsWith('/agent') ?? false);

  const preloadAgent = () => {
    void preloadAgentHomeRoute();
  };

  // Navigate on every click (not only when the mode changes) so pressing the
  // already-active tab from a neutral route (settings, etc.) still jumps to
  // that mode's home screen.
  return (
    <Tabs value={mode} className="px-1 pt-1">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger
          value="chat"
          className="gap-1.5"
          data-testid="sidebar-mode-chat"
          onClick={() => navigate('/')}
        >
          <MessageCircle className="size-3.5" />
          <span className="text-xs">{t('mode_chat')}</span>
        </TabsTrigger>
        <TabsTrigger
          value="agent"
          className="gap-1.5"
          data-testid="sidebar-mode-agent"
          onPointerEnter={preloadAgent}
          onFocus={preloadAgent}
          onClick={() => {
            preloadAgent();
            navigate('/agent');
          }}
        >
          {isAgentLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          <span className="text-xs">{t('mode_agent')}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
