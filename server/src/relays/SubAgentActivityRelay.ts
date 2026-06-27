import {
  buildDuckDuckGoSearchUrl,
  sanitizeDuckDuckGoQuery,
  type BrowserResearchAgent
} from 'tenjo-chat-engine';
import { generateUuidV4 } from '../utils/generateUuidV4';

/**
 * Generic, framework-style payload for sub-agent activity relayed to the
 * client. New sub-agents (for example a coding sub-agent) should reuse this shape so
 * the UI can render their progress with the same component.
 *
 * `agentType` tags which sub-agent emitted the event so the UI can choose how
 * to render it; `toolName` + `detail` are the only things normally surfaced
 * (for example "browser_navigate" + the URL it loaded). `url`, when set, is the
 * page the sub-agent loaded — search activities carry the SERP URL so the
 * client does not have to re-derive it.
 */
export interface SubAgentActivityEvent {
  agentId: string;
  agentType: string;
  activityId: string;
  toolName: string;
  detail?: string;
  url?: string;
  status: 'started' | 'completed' | 'failed';
  timestamp: number;
}

export interface SubAgentActivityWriter {
  emit(event: SubAgentActivityEvent): void;
}

/**
 * Wires up a {@link BrowserResearchAgent}'s tool-start / tool-end hooks to a
 * generic {@link SubAgentActivityWriter}. Only "where did the browser go"
 * events (search queries + navigation URLs) are forwarded — the agent's
 * internal page snapshots, scrolls, clicks, etc. are intentionally left out
 * so the UI stays focused on the question the user asked: which pages did
 * the sub-agent visit?
 */
export function createSubAgentActivityRelay(
  agent: BrowserResearchAgent,
  writer: SubAgentActivityWriter,
  agentType: string = 'browser-research'
): void {
  const agentId = generateUuidV4();
  // tool-call id → activityId so the start/end events match up.
  const toolCallToActivity = new Map<string, string>();

  interface ReportableInfo {
    detail: string | undefined;
    url: string | undefined;
  }

  const infoFor = (
    name: string,
    args: Record<string, unknown>
  ): ReportableInfo => {
    if (name === 'browser_duckduckgo_search') {
      const rawQuery = typeof args.query === 'string' ? args.query : undefined;
      // Surface the same sanitized query that is actually searched (double
      // quotes stripped) so the UI matches what DuckDuckGo received.
      const query = rawQuery ? sanitizeDuckDuckGoQuery(rawQuery) : undefined;
      return {
        detail: query || undefined,
        url: query ? buildDuckDuckGoSearchUrl(query) : undefined
      };
    }
    if (name === 'browser_navigate') {
      const url = typeof args.url === 'string' ? args.url : undefined;
      return { detail: url, url };
    }
    return { detail: undefined, url: undefined };
  };

  const isReportable = (name: string): boolean =>
    name === 'browser_duckduckgo_search' || name === 'browser_navigate';

  agent.setEvents({
    onToolStart: (name, args) => {
      if (!isReportable(name)) return;
      const activityId = generateUuidV4();
      // Use args.toolCallId-style key when available; fall back to the
      // activityId so we can still match end events.
      const key = `${name}:${activityId}`;
      toolCallToActivity.set(key, activityId);
      const info = infoFor(name, args);
      writer.emit({
        agentId,
        agentType,
        activityId,
        toolName: name,
        detail: info.detail,
        url: info.url,
        status: 'started',
        timestamp: Date.now()
      });
    },
    onToolEnd: (name, args, result) => {
      if (!isReportable(name)) return;
      // The agent does not give us a tool-call id, so we look up the most
      // recent matching activity by tool name + detail. Since these tools
      // run sequentially within a single agent, this is unambiguous.
      const info = infoFor(name, args);
      let matchedKey: string | undefined;
      for (const key of Array.from(toolCallToActivity.keys()).reverse()) {
        if (key.startsWith(`${name}:`)) {
          matchedKey = key;
          break;
        }
      }
      const matchedActivity = matchedKey
        ? toolCallToActivity.get(matchedKey)
        : undefined;
      const activityId = matchedActivity ?? generateUuidV4();
      if (matchedKey) toolCallToActivity.delete(matchedKey);
      const isError =
        result !== null &&
        typeof result === 'object' &&
        'error' in (result as Record<string, unknown>);
      writer.emit({
        agentId,
        agentType,
        activityId,
        toolName: name,
        detail: info.detail,
        url: info.url,
        status: isError ? 'failed' : 'completed',
        timestamp: Date.now()
      });
    }
  });
}
