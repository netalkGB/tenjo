import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import {
  agentEventBus,
  agentGuiService,
  agentProjectService
} from '../services/registry';
import { agentSessionService } from '../services/AgentSessionService';
import {
  getSandboxStatus,
  isAgentSandboxReady,
  onSandboxStatusChange,
  type SandboxStatusInfo
} from '../services/AgentSandboxService';
import type { AgentSubscriber } from '../events/AgentEventBus';
import type { AgentProject } from '../repositories/AgentProjectRepository';
import type { AgentServerEvent } from '../types/agentProtocol';
import {
  getUpgradeSessionUser,
  isValidUpgradeCsrfToken,
  isValidUpgradeOrigin,
  loadUpgradeSession,
  rejectUpgrade
} from './upgradeAuth';
import logger from '../logger';

const AGENT_EVENTS_PATH = /^\/api\/agent\/projects\/([^/]+)\/events$/;
const wss = new WebSocketServer({ noServer: true });

// Wire form of the sandbox status (the internal `unknown` reads as `preparing`).
function toSandboxStatusEvent(
  info: SandboxStatusInfo
): Extract<AgentServerEvent, { type: 'sandbox-status' }> {
  return {
    type: 'sandbox-status',
    status: info.status === 'unknown' ? 'preparing' : info.status,
    detail: info.detail
  };
}

function sendToSubscriber(
  subscriber: AgentSubscriber,
  event: AgentServerEvent
): void {
  agentEventBus.sendToSubscriber(subscriber, event);
}

async function pushTree(
  projectId: string,
  subscriber: AgentSubscriber
): Promise<void> {
  // Retry a few times: buildTree starts the project pod, which can briefly fail
  // on a transient race (pod mid-start). Without a retry a single failure leaves
  // the file panel empty until the next status change, which may never come once
  // the global sandbox is ready.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!subscriber.isOpen()) {
      return;
    }
    try {
      const { nodes, contextNodes } =
        await agentSessionService.buildTree(projectId);
      sendToSubscriber(subscriber, {
        type: 'file-tree',
        nodes,
        contextNodes
      });
      return;
    } catch {
      // Sandbox may still be coming up - back off briefly and retry.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

function sendInitialEvents(
  project: AgentProject,
  subscriber: AgentSubscriber
): () => void {
  agentEventBus.subscribe(project.id, subscriber);
  sendToSubscriber(subscriber, {
    type: 'project-status',
    status: project.status
  });
  sendToSubscriber(subscriber, {
    type: 'mode',
    mode: project.mode
  });
  sendToSubscriber(subscriber, toSandboxStatusEvent(getSandboxStatus()));

  // Current GUI preview status can hit podman; do not block the socket open.
  void agentGuiService
    .status(project)
    .then((status) => {
      sendToSubscriber(subscriber, {
        type: 'gui-status',
        status
      });
    })
    .catch(() => {
      // Sandbox may be unavailable - the client keeps its default state.
    });

  const unsubscribeStatus = onSandboxStatusChange((info: SandboxStatusInfo) => {
    sendToSubscriber(subscriber, toSandboxStatusEvent(info));
    if (info.status === 'ready') {
      void pushTree(project.id, subscriber);
    }
  });

  // Re-send requests still awaiting a decision, so reconnecting clients can
  // answer them instead of staring at a spinner.
  for (const request of agentSessionService.listPendingToolApprovals(
    project.id
  )) {
    sendToSubscriber(subscriber, request);
  }
  for (const question of agentSessionService.listPendingQuestions(project.id)) {
    sendToSubscriber(subscriber, question);
  }
  if (isAgentSandboxReady()) {
    void pushTree(project.id, subscriber);
  }

  return () => {
    unsubscribeStatus();
    agentEventBus.unsubscribe(subscriber);
  };
}

async function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  projectId: string
): Promise<void> {
  if (!isValidUpgradeOrigin(req)) {
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }

  await loadUpgradeSession(req);
  if (!isValidUpgradeCsrfToken(req)) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  const user = getUpgradeSessionUser(req);
  if (!user) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }
  const project = await agentProjectService.findByIdAndUser(projectId, user.id);
  if (!project) {
    rejectUpgrade(socket, 404, 'Not Found');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const subscriber: AgentSubscriber = {
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },
      isOpen: () => ws.readyState === WebSocket.OPEN
    };
    const cleanup = sendInitialEvents(project, subscriber);
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 25_000);
    ws.on('close', () => {
      clearInterval(heartbeat);
      cleanup();
    });
    ws.on('error', () => {
      clearInterval(heartbeat);
      cleanup();
    });
  });
}

/** Attach Agent event WebSocket upgrades to the HTTP server. */
export function attachAgentEventRelay(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    const match = pathname.match(AGENT_EVENTS_PATH);
    if (!match) {
      return;
    }
    handleUpgrade(req, socket, head, match[1]).catch((error: unknown) => {
      logger.warn('[agent-event-relay] upgrade failed', { error });
      socket.destroy();
    });
  });
}
