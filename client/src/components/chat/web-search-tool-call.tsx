import { useState } from 'react';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
  Search,
  AlertTriangle
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { MarkdownRenderer } from './markdown-renderer';
import type { ToolCallInfo } from './tool-call-section';
import type { SubAgentActivityInfo } from './sub-agent-activity';

const BROWSER_SEARCH_TOOL = 'browser_duckduckgo_search';
const BROWSER_NAVIGATE_TOOL = 'browser_navigate';

interface SearchEntry {
  query: string;
  url: string;
}

interface WebSearchResult {
  answer?: string;
  incomplete?: boolean;
  note?: string;
  /**
   * Distinct DuckDuckGo searches the sub-agent ran, paired with the
   * results-page URL it actually loaded. The URL is built server-side so
   * the client never has to know the search-engine URL format.
   */
  searches?: SearchEntry[];
  visitedUrls?: string[];
  timedOut?: boolean;
  error?: string;
}

function resolveSearchEntries(result: WebSearchResult | null): SearchEntry[] {
  if (result?.searches && result.searches.length > 0) return result.searches;
  return [];
}

function asResult(value: unknown): WebSearchResult | null {
  if (!value || typeof value !== 'object') return null;
  return value as WebSearchResult;
}

interface VisitedItem {
  kind: 'search' | 'page';
  label: string;
  href: string;
  key: string;
  status: 'started' | 'completed' | 'failed';
}

function searchItem(
  query: string,
  url: string,
  key: string,
  status: VisitedItem['status']
): VisitedItem {
  return {
    kind: 'search',
    label: `DuckDuckGo: ${query}`,
    href: url,
    key,
    status
  };
}

function pageItem(
  url: string,
  key: string,
  status: VisitedItem['status']
): VisitedItem {
  return { kind: 'page', label: url, href: url, key, status };
}

function buildItemsFromResult(
  searches: SearchEntry[],
  visited: string[]
): VisitedItem[] {
  const items: VisitedItem[] = [];
  searches.forEach((s, i) =>
    items.push(searchItem(s.query, s.url, `q-${i}-${s.query}`, 'completed'))
  );
  visited.forEach((url, i) =>
    items.push(pageItem(url, `u-${i}-${url}`, 'completed'))
  );
  return items;
}

function buildItemsFromActivities(
  activities: SubAgentActivityInfo[]
): VisitedItem[] {
  const items: VisitedItem[] = [];
  for (const a of activities) {
    if (a.toolName === BROWSER_SEARCH_TOOL) {
      const query = a.detail ?? '';
      const url = a.url ?? '';
      if (!query || !url) continue;
      items.push(searchItem(query, url, a.activityId, a.status));
    } else if (a.toolName === BROWSER_NAVIGATE_TOOL) {
      const url = a.url ?? a.detail ?? '';
      if (!url) continue;
      items.push(pageItem(url, a.activityId, a.status));
    }
  }
  return items;
}

interface WebSearchToolCallProps {
  toolCall: ToolCallInfo;
  activities?: SubAgentActivityInfo[];
}

export function WebSearchToolCall({
  toolCall,
  activities
}: WebSearchToolCallProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [answerOpen, setAnswerOpen] = useState(false);

  const isStreaming = toolCall.status === 'streaming';
  const isRunning = toolCall.status === 'calling' || isStreaming;

  const result = asResult(toolCall.result);

  const visitedItems = isRunning
    ? buildItemsFromActivities(activities ?? [])
    : buildItemsFromResult(
        resolveSearchEntries(result),
        result?.visitedUrls ?? []
      );

  const statusIcon = isRunning ? (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  ) : result?.timedOut ? (
    <AlertTriangle className="h-4 w-4 text-yellow-500" />
  ) : toolCall.success ? (
    <CheckCircle2 className="h-4 w-4 text-green-500" />
  ) : (
    <XCircle className="h-4 w-4 text-red-500" />
  );

  const statusText = isRunning
    ? t('web_search_running')
    : result?.timedOut
      ? t('web_search_timed_out')
      : result?.incomplete
        ? t('web_search_incomplete')
        : toolCall.success
          ? t('web_search_completed')
          : t('web_search_failed');

  return (
    <div className="rounded-md border border-border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs">{t('web_search')}</span>
        {statusIcon}
        <span className="ml-auto text-xs text-muted-foreground">
          {statusText}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3 text-xs">
          <section>
            <div className="mb-1 font-semibold text-muted-foreground">
              {t('web_search_visited')}
            </div>
            {visitedItems.length === 0 ? (
              !isRunning ? (
                <div className="italic text-muted-foreground">
                  {t('web_search_no_pages')}
                </div>
              ) : null
            ) : (
              <ul className="space-y-1">
                {visitedItems.map(item => (
                  <li key={item.key} className="flex items-start gap-2">
                    {item.status === 'started' ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : item.kind === 'search' ? (
                      <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all text-primary hover:underline"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!isRunning && result?.answer && (
            <section>
              <button
                type="button"
                className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground"
                onClick={() => setAnswerOpen(!answerOpen)}
              >
                <ChevronRight
                  className={`h-3 w-3 shrink-0 transition-transform ${answerOpen ? 'rotate-90' : ''}`}
                />
                <span>{t('web_search_answer')}</span>
              </button>
              {answerOpen && (
                <div className="mt-1 rounded bg-muted/40 px-2 py-1.5">
                  <MarkdownRenderer markdown={result.answer} />
                </div>
              )}
            </section>
          )}

          {result?.error && (
            <section className="rounded border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-red-600 dark:text-red-400">
              {result.error}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
