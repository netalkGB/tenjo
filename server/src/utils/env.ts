import path from 'node:path';
import 'dotenv/config';

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

let cachedDataDir: string | undefined;

export const getDataDir = (): string => {
  if (!cachedDataDir) {
    cachedDataDir = process.env.DATA_DIR || path.resolve('files');
  }
  return cachedDataDir;
};
