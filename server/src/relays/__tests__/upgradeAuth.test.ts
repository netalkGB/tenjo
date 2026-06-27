import { afterEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { Request } from 'express';
import { isValidUpgradeCsrfToken, isValidUpgradeOrigin } from '../upgradeAuth';

function createRequest(input: {
  url?: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  csrfToken?: string;
}): IncomingMessage {
  const req = {
    url: input.url ?? '/api/agent/projects/project-1/events',
    headers: {
      origin: input.origin,
      host: input.host,
      'x-forwarded-host': input.forwardedHost,
      'x-forwarded-proto': input.forwardedProto
    },
    socket: {}
  } as unknown as IncomingMessage;
  (req as unknown as Request).session = {
    csrfToken: input.csrfToken
  } as unknown as Request['session'];
  return req;
}

describe('upgradeAuth', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('accepts same-origin WebSocket upgrades', () => {
    const req = createRequest({
      origin: 'https://example.com',
      host: 'example.com',
      forwardedProto: 'https'
    });

    expect(isValidUpgradeOrigin(req)).toBe(true);
  });

  it('accepts forwarded host upgrades behind a proxy', () => {
    const req = createRequest({
      origin: 'https://app.example.com',
      host: '127.0.0.1:3000',
      forwardedHost: 'app.example.com',
      forwardedProto: 'https'
    });

    expect(isValidUpgradeOrigin(req)).toBe(true);
  });

  it('rejects cross-origin WebSocket upgrades', () => {
    const req = createRequest({
      origin: 'https://attacker.example',
      host: 'example.com',
      forwardedProto: 'https'
    });

    expect(isValidUpgradeOrigin(req)).toBe(false);
  });

  it('rejects missing Origin headers', () => {
    const req = createRequest({
      host: 'example.com',
      forwardedProto: 'https'
    });

    expect(isValidUpgradeOrigin(req)).toBe(false);
  });

  it('accepts a matching CSRF token from the WebSocket URL', () => {
    process.env.NODE_ENV = 'production';
    const req = createRequest({
      url: '/api/agent/projects/project-1/events?_csrf=token-1',
      csrfToken: 'token-1'
    });

    expect(isValidUpgradeCsrfToken(req)).toBe(true);
  });

  it('rejects a missing or mismatched CSRF token', () => {
    process.env.NODE_ENV = 'production';
    const req = createRequest({
      url: '/api/agent/projects/project-1/events?_csrf=bad-token',
      csrfToken: 'token-1'
    });

    expect(isValidUpgradeCsrfToken(req)).toBe(false);
  });

  it('skips CSRF token validation in development', () => {
    process.env.NODE_ENV = 'development';
    const req = createRequest({
      url: '/api/agent/projects/project-1/events'
    });

    expect(isValidUpgradeCsrfToken(req)).toBe(true);
  });
});
