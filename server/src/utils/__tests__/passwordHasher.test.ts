import { describe, it, expect } from 'vitest';
import { deserialize } from '@phc/format';
import { hashPassword, verifyPassword } from '../passwordHasher';

describe('passwordHasher', () => {
  describe('hashPassword', () => {
    it('should return a valid PHC-format string', async () => {
      const hash = await hashPassword('testPassword123');
      expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$.+\$.+$/);
    });

    it('should produce a parseable PHC string with correct fields', async () => {
      const hash = await hashPassword('testPassword123');
      const parsed = deserialize(hash);

      expect(parsed.id).toBe('argon2id');
      expect(parsed.version).toBe(19);
      expect(parsed.params).toEqual({ m: 65536, t: 3, p: 4 });
      expect(parsed.salt).toBeInstanceOf(Buffer);
      expect(parsed.salt?.length).toBe(16);
      expect(parsed.hash).toBeInstanceOf(Buffer);
      expect(parsed.hash?.length).toBe(32);
    });

    it('should produce different hashes for the same password (random salt)', async () => {
      const hash1 = await hashPassword('samePassword');
      const hash2 = await hashPassword('samePassword');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different passwords', async () => {
      const hash1 = await hashPassword('password1');
      const hash2 = await hashPassword('password2');

      const parsed1 = deserialize(hash1);
      const parsed2 = deserialize(hash2);
      expect(parsed1.hash).not.toEqual(parsed2.hash);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for the correct password', async () => {
      const hash = await hashPassword('correctPassword');
      const result = await verifyPassword(hash, 'correctPassword');
      expect(result).toBe(true);
    });

    it('should return false for an incorrect password', async () => {
      const hash = await hashPassword('correctPassword');
      const result = await verifyPassword(hash, 'wrongPassword');
      expect(result).toBe(false);
    });

    it('should return false for empty password against a hash', async () => {
      const hash = await hashPassword('somePassword');
      const result = await verifyPassword(hash, '');
      expect(result).toBe(false);
    });

    it('should verify a hash with known PHC string', async () => {
      // Generate a hash and immediately verify to ensure round-trip works
      const password = 'Unicode日本語パスワード🔑';
      const hash = await hashPassword(password);
      expect(await verifyPassword(hash, password)).toBe(true);
      expect(await verifyPassword(hash, 'wrong')).toBe(false);
    });

    it('should throw on invalid PHC string', async () => {
      await expect(verifyPassword('not-a-phc-string', 'pw')).rejects.toThrow();
    });

    it('should throw on PHC string missing hash', async () => {
      // A PHC string with only id and version, no salt/hash
      await expect(
        verifyPassword('$argon2id$v=19$m=65536,t=3,p=4', 'pw')
      ).rejects.toThrow('Invalid PHC hash: missing required fields');
    });
  });
});
