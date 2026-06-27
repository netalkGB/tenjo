import { useEffect, useRef, useState } from 'react';
import { AgentServerEventSchema, type AgentServerEvent } from './schemas';
import { urlPath } from '@/lib/urlPath';
import { csrfWebSocketUrl } from './csrfWebSocketUrl';

export type AgentConnection = 'connecting' | 'open' | 'closed';

function agentEventsUrl(projectId: string): string {
  return csrfWebSocketUrl(
    urlPath('api', 'agent', 'projects', projectId, 'events')
  );
}

/**
 * Subscribe to a project's Agent event stream over WebSocket. The server
 * re-sends the current status, mode and file tree on each (re)connect. Every
 * frame is validated before it reaches `onEvent`. Commands are sent separately
 * via the REST helpers.
 */
export function useAgentEvents(
  projectId: string | undefined,
  onEvent: (event: AgentServerEvent) => void
): { connection: AgentConnection } {
  const [connection, setConnection] = useState<AgentConnection>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    setReconnectAttempt(0);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setConnection('connecting');
      return;
    }

    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    setConnection('connecting');
    const socket = new WebSocket(agentEventsUrl(projectId));

    socket.onopen = () => setConnection('open');
    socket.onerror = () => setConnection('closed');
    socket.onclose = () => {
      setConnection('closed');
      if (stopped) {
        return;
      }
      reconnectTimer = setTimeout(() => {
        setReconnectAttempt(attempt => attempt + 1);
      }, 1000);
    };
    socket.onmessage = event => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const result = AgentServerEventSchema.safeParse(parsed);
      if (result.success) {
        onEventRef.current(result.data);
      }
    };

    return () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket.close();
    };
  }, [projectId, reconnectAttempt]);

  return { connection };
}
