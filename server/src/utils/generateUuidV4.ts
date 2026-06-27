import crypto from 'node:crypto';

export function generateUuidV4(): string {
  return crypto.randomUUID();
}
