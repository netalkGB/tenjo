import { Globe, Loader2, Search, Check, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * UI-side mirror of the server's `SubAgentActivityEvent`. We accumulate
 * `started` events into this shape and flip `status` when the matching
 * `completed` / `failed` event arrives. Designed to be agent-agnostic — a
 * future sub-agent can emit the same payload and the UI will render it the
 * same way; only the icon mapping needs an update.
 */
export interface SubAgentActivityInfo {
  activityId: string;
  agentId: string;
  agentType: string;
  toolName: string;
  detail?: string;
  url?: string;
  status: 'started' | 'completed' | 'failed';
}

interface SubAgentActivityListProps {
  activities: SubAgentActivityInfo[];
}

const BROWSER_SEARCH_TOOL = 'browser_duckduckgo_search';
const BROWSER_NAVIGATE_TOOL = 'browser_navigate';

function ActivityIcon({ activity }: { activity: SubAgentActivityInfo }) {
  if (activity.status === 'started') {
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    );
  }
  if (activity.status === 'failed') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (activity.toolName === BROWSER_SEARCH_TOOL) {
    return <Search className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (activity.toolName === BROWSER_NAVIGATE_TOOL) {
    return <Globe className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
}

function ActivityRow({ activity }: { activity: SubAgentActivityInfo }) {
  const { t } = useTranslation();
  const label =
    activity.toolName === BROWSER_SEARCH_TOOL
      ? t('sub_agent_search')
      : activity.toolName === BROWSER_NAVIGATE_TOOL
        ? t('sub_agent_navigate')
        : activity.toolName;

  const detail = activity.detail ?? '';
  const isUrl = /^https?:\/\//i.test(detail);

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">
        <ActivityIcon activity={activity} />
      </span>
      <span className="shrink-0 font-medium text-muted-foreground">
        {label}
      </span>
      {detail &&
        (isUrl ? (
          <a
            href={detail}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-primary hover:underline"
          >
            {detail}
          </a>
        ) : (
          <span className="break-all">{detail}</span>
        ))}
    </div>
  );
}

export function SubAgentActivityList({
  activities
}: SubAgentActivityListProps) {
  if (activities.length === 0) return null;

  return (
    <div
      className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="sub-agent-activity"
    >
      <div className="flex flex-col gap-1">
        {activities.map(activity => (
          <ActivityRow key={activity.activityId} activity={activity} />
        ))}
      </div>
    </div>
  );
}
