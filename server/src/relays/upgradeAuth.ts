import { ServerResponse, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Request, Response } from 'express';
import { sessionMiddleware } from '../middleware/session';
import { isDevelopment } from '../utils/env';
import type { SessionUser } from '../types/api';

/** Run the session middleware against a bare upgrade request. */
export function loadUpgradeSession(req: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    // A detached response object satisfies the middleware's header hooks; the
    // read-only session lookup never actually writes to it.
    const res = new ServerResponse(req);
    sessionMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      (error?: unknown) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } else {
          resolve();
        }
      }
    );
  });
}

export function getUpgradeSessionUser(
  req: IncomingMessage
): SessionUser | undefined {
  return (req as unknown as Request).session?.user;
}

function firstHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim();
}

function requestProto(req: IncomingMessage): 'http' | 'https' {
  const forwardedProto = firstForwardedValue(
    firstHeaderValue(req.headers['x-forwarded-proto'])
  );
  if (forwardedProto === 'https' || forwardedProto === 'http') {
    return forwardedProto;
  }
  return 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http';
}

function requestHosts(req: IncomingMessage): string[] {
  const hosts = [
    firstForwardedValue(firstHeaderValue(req.headers['x-forwarded-host'])),
    firstHeaderValue(req.headers.host)
  ].filter((host): host is string => Boolean(host));
  return Array.from(new Set(hosts));
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export function isValidUpgradeOrigin(req: IncomingMessage): boolean {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) {
    return false;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  const expectedProto = requestProto(req);
  const allowedOrigins = requestHosts(req).map(
    (host) => `${expectedProto}://${host}`
  );
  if (allowedOrigins.includes(parsedOrigin.origin)) {
    return true;
  }

  return isDevelopment() && isLoopbackHostname(parsedOrigin.hostname);
}

export function isValidUpgradeCsrfToken(req: IncomingMessage): boolean {
  if (isDevelopment()) {
    return true;
  }

  const sessionToken = (req as unknown as Request).session?.csrfToken;
  if (!sessionToken) {
    return false;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('_csrf') === sessionToken;
}

/** Refuse the upgrade with a plain HTTP response on the raw socket. */
export function rejectUpgrade(
  socket: Duplex,
  status: number,
  text: string
): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
}
