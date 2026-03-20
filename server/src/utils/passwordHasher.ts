import crypto, { type Argon2Algorithm } from 'node:crypto';
import { promisify } from 'node:util';
import { serialize, deserialize } from '@phc/format';

const argon2Async = promisify(crypto.argon2);

const ALGORITHM: Argon2Algorithm = 'argon2id';
const VERSION = 19;
const DEFAULTS = {
  memory: 65536, // 64 MiB
  passes: 3,
  parallelism: 4,
  tagLength: 32,
  saltLength: 16
} as const;

/**
 * Hash a password and return a PHC-format string.
 * Output: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(DEFAULTS.saltLength);

  const hash = await argon2Async(ALGORITHM, {
    message: Buffer.from(password),
    nonce: salt,
    memory: DEFAULTS.memory,
    passes: DEFAULTS.passes,
    parallelism: DEFAULTS.parallelism,
    tagLength: DEFAULTS.tagLength
  });

  return serialize({
    id: ALGORITHM,
    version: VERSION,
    params: {
      m: DEFAULTS.memory,
      t: DEFAULTS.passes,
      p: DEFAULTS.parallelism
    },
    salt,
    hash
  });
}

/**
 * Verify a password against a PHC-format hash string.
 */
export async function verifyPassword(
  phc: string,
  password: string
): Promise<boolean> {
  const { id, params, salt, hash } = deserialize(phc);

  if (!params || !salt || !hash) {
    throw new Error('Invalid PHC hash: missing required fields');
  }

  const computed = await argon2Async(id as Argon2Algorithm, {
    message: Buffer.from(password),
    nonce: salt,
    memory: params.m as number,
    passes: params.t as number,
    parallelism: params.p as number,
    tagLength: hash.length
  });

  return crypto.timingSafeEqual(hash, computed);
}
