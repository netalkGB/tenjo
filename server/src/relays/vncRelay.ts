import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import net from 'node:net';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { agentProjectRepo } from '../repositories/registry';
import { agentGuiService } from '../services/registry';
import { touch as touchIdle } from '../services/AgentIdleReaperService';
import {
  getUpgradeSessionUser,
  isValidUpgradeCsrfToken,
  isValidUpgradeOrigin,
  loadUpgradeSession,
  rejectUpgrade
} from './upgradeAuth';
import logger from '../logger';

/**
 * Connected VNC preview viewers per project. A user actively watching the
 * preview counts as activity, so the idle reaper does not stop the pod under
 * them (see {@link hasVncViewer}).
 */
const viewerCounts = new Map<string, number>();

/** Whether at least one VNC preview viewer is connected for this project. */
export function hasVncViewer(projectId: string): boolean {
  return (viewerCounts.get(projectId) ?? 0) > 0;
}

function addViewer(projectId: string): void {
  viewerCounts.set(projectId, (viewerCounts.get(projectId) ?? 0) + 1);
  touchIdle(projectId);
}

function removeViewer(projectId: string): void {
  const next = (viewerCounts.get(projectId) ?? 0) - 1;
  if (next > 0) {
    viewerCounts.set(projectId, next);
  } else {
    viewerCounts.delete(projectId);
  }
  // A disconnect starts the idle countdown from now.
  touchIdle(projectId);
}

/**
 * WebSocket → TCP relay between the browser's VNC client (noVNC speaks RFB
 * over binary WebSocket frames) and the project's VNC server. The TCP target
 * is the sandbox container IP (or AGENT_SANDBOX_VNC_HOST), not a host-published
 * RFB port. The HTTP `upgrade` event bypasses the Express middleware chain, so
 * the request is authenticated here by running the SAME session middleware by
 * hand and then checking project ownership — an unauthenticated or foreign
 * socket never reaches the VNC port.
 */

const VNC_PATH = /^\/api\/agent\/projects\/([^/]+)\/vnc$/;

const wss = new WebSocketServer({ noServer: true });

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** Bidirectional pipe between an accepted WebSocket and the VNC TCP port. */
function pipeToVnc(
  ws: WebSocket,
  target: { host: string; port: number }
): void {
  const tcp = net.connect(target);
  // Server → client is the heavy direction (framebuffer updates). Pause the
  // TCP side until the WebSocket flushed each chunk, so a slow client can
  // never make the relay buffer an unbounded amount of pixels in memory.
  tcp.on('data', (chunk: Buffer) => {
    tcp.pause();
    ws.send(chunk, (error?: Error) => {
      if (error) {
        tcp.destroy();
        return;
      }
      tcp.resume();
    });
  });
  // Client → server carries only small input events; write straight through.
  ws.on('message', (data: RawData) => {
    tcp.write(toBuffer(data));
  });
  tcp.on('close', () => ws.close());
  tcp.on('error', (error) => {
    logger.warn('[vnc-relay] VNC connection error', { error });
    ws.close();
  });
  ws.on('close', () => tcp.destroy());
  ws.on('error', () => tcp.destroy());
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
  const project = await agentProjectRepo.findByIdAndUser(projectId, user.id);
  if (!project) {
    rejectUpgrade(socket, 404, 'Not Found');
    return;
  }
  const target = await agentGuiService.vncTarget(project);
  if (!target) {
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Count this viewer for the idle reaper, releasing it on disconnect.
    addViewer(projectId);
    ws.on('close', () => removeViewer(projectId));
    pipeToVnc(ws, target);
  });
}

/** Attach the relay to the HTTP server's `upgrade` event. */
export function attachVncRelay(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    const match = pathname.match(VNC_PATH);
    if (!match) {
      return;
    }
    handleUpgrade(req, socket, head, match[1]).catch((error: unknown) => {
      logger.warn('[vnc-relay] upgrade failed', { error });
      socket.destroy();
    });
  });
}
