import { createRequire } from 'node:module';
import path from 'node:path';
import 'dotenv/config';

const rootPkg = createRequire(__filename)('../../package.json') as {
  name: string;
};

export const getAppName = (): string => rootPkg.name;

export const isDevelopment = (): boolean => {
  return process.env.NODE_ENV !== 'production';
};

export const getSessionSecret = (): string | undefined => {
  return process.env.SESSION_SECRET;
};

export const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return url;
};

export const getDatabaseSchema = (): string => {
  return process.env.DATABASE_SCHEMA || 'public';
};

export const isSingleUserMode = (): boolean => {
  return process.env.SINGLE_USER_MODE === 'true';
};

export const getEncryptionKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return key;
};

const DEFAULT_OAUTH_CALLBACK_PATH = '/api/settings/mcp-oauth/callback';

/**
 * Build the full OAuth redirect URL from BASE_URL (required).
 *
 * - http/https: appends the standard callback path
 *   e.g. BASE_URL=http://localhost:5173 → http://localhost:5173/api/settings/mcp-oauth/callback
 * - Other schemes: used as-is (e.g. custom URL scheme for Electron)
 *   e.g. BASE_URL=myapp://oauth/callback → myapp://oauth/callback
 */
export const getOAuthRedirectUrl = (): string => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error('BASE_URL environment variable is required');
  }
  // Non-HTTP scheme (e.g. custom URL scheme for Electron): use as-is
  if (!/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }
  // Strip trailing slashes to avoid "http://host//api/..."
  const origin = baseUrl.replace(/\/+$/, '');
  return `${origin}${DEFAULT_OAUTH_CALLBACK_PATH}`;
};

let cachedDataDir: string | undefined;

export const getDataDir = (): string => {
  if (!cachedDataDir) {
    cachedDataDir = process.env.DATA_DIR || path.resolve('files');
  }
  return cachedDataDir;
};
