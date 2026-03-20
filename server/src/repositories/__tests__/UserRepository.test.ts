import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserRepository } from '../UserRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('UserRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let userRepository: UserRepository;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'user' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    userRepository = new UserRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
  });

  describe('create', () => {
    it('should create a new user', async () => {
      const userData = {
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      };

      const user = await userRepository.create(userData);

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.full_name).toBe(userData.full_name);
      expect(user.user_name).toBe(userData.user_name);
      expect(user.email).toBe(userData.email);
      expect(user.password).toBe(userData.password);
    });

    it('should auto-generate an id for new users', async () => {
      const user1 = await userRepository.create({
        full_name: 'User One',
        user_name: 'user1',
        email: 'user1@example.com',
        password: 'password1'
      });

      const user2 = await userRepository.create({
        full_name: 'User Two',
        user_name: 'user2',
        email: 'user2@example.com',
        password: 'password2'
      });

      expect(user1.id).toBeDefined();
      expect(user2.id).toBeDefined();
      expect(user1.id).not.toBe(user2.id);
    });
  });

  describe('findAll', () => {
    it('should return an empty array when no users exist', async () => {
      const users = await userRepository.findAll();
      expect(users).toEqual([]);
    });

    it('should return all users', async () => {
      await userRepository.create({
        full_name: 'User One',
        user_name: 'user1',
        email: 'user1@example.com',
        password: 'password1'
      });
      await userRepository.create({
        full_name: 'User Two',
        user_name: 'user2',
        email: 'user2@example.com',
        password: 'password2'
      });

      const users = await userRepository.findAll();

      expect(users).toHaveLength(2);
      expect(users[0].full_name).toBe('User One');
      expect(users[1].full_name).toBe('User Two');
    });
  });

  describe('findById', () => {
    it('should return undefined when user does not exist', async () => {
      const user = await userRepository.findById(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(user).toBeUndefined();
    });

    it('should return user when user exists', async () => {
      const createdUser = await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const foundUser = await userRepository.findById(createdUser.id);

      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(createdUser.id);
      expect(foundUser?.full_name).toBe('John Doe');
      expect(foundUser?.email).toBe('john@example.com');
    });
  });

  describe('findByEmail', () => {
    it('should return undefined when no user matches the email', async () => {
      const user = await userRepository.findByEmail('nonexistent@example.com');
      expect(user).toBeUndefined();
    });

    it('should return user when email matches', async () => {
      await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const foundUser = await userRepository.findByEmail('john@example.com');

      expect(foundUser).toBeDefined();
      expect(foundUser?.email).toBe('john@example.com');
      expect(foundUser?.user_name).toBe('john');
    });
  });

  describe('findByUserName', () => {
    it('should return undefined when no user matches the username', async () => {
      const user = await userRepository.findByUserName('nonexistent');
      expect(user).toBeUndefined();
    });

    it('should return user when username matches', async () => {
      await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const foundUser = await userRepository.findByUserName('john');

      expect(foundUser).toBeDefined();
      expect(foundUser?.user_name).toBe('john');
      expect(foundUser?.email).toBe('john@example.com');
    });
  });

  describe('existsAdmin', () => {
    it('should return false when no admin user exists', async () => {
      await userRepository.create({
        full_name: 'Standard User',
        user_name: 'standard',
        email: 'standard@example.com',
        password: 'password'
      });

      const result = await userRepository.existsAdmin();
      expect(result).toBe(false);
    });

    it('should return true when an admin user exists', async () => {
      await userRepository.create({
        full_name: 'Admin User',
        user_name: 'admin',
        email: 'admin@example.com',
        password: 'password',
        user_role: 'admin'
      });

      const result = await userRepository.existsAdmin();
      expect(result).toBe(true);
    });

    it('should return false when no users exist', async () => {
      const result = await userRepository.existsAdmin();
      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('should return undefined when user does not exist', async () => {
      const result = await userRepository.update(
        '00000000-0000-0000-0000-000000000000',
        { full_name: 'Updated Name' }
      );
      expect(result).toBeUndefined();
    });

    it('should update user when user exists', async () => {
      const createdUser = await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const updatedUser = await userRepository.update(createdUser.id, {
        full_name: 'Jane Doe',
        user_name: 'jane'
      });

      expect(updatedUser).toBeDefined();
      expect(updatedUser?.id).toBe(createdUser.id);
      expect(updatedUser?.full_name).toBe('Jane Doe');
      expect(updatedUser?.user_name).toBe('jane');
      expect(updatedUser?.email).toBe('john@example.com'); // Should remain unchanged
    });

    it('should update only specified fields', async () => {
      const createdUser = await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const updatedUser = await userRepository.update(createdUser.id, {
        user_name: 'johndoe'
      });

      expect(updatedUser).toBeDefined();
      expect(updatedUser?.user_name).toBe('johndoe');
      expect(updatedUser?.full_name).toBe('John Doe'); // Should remain unchanged
    });
  });

  describe('delete', () => {
    it('should return false when user does not exist', async () => {
      const result = await userRepository.delete(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBe(false);
    });

    it('should delete user and return true when user exists', async () => {
      const createdUser = await userRepository.create({
        full_name: 'John Doe',
        user_name: 'john',
        email: 'john@example.com',
        password: 'hashed_password_123'
      });

      const result = await userRepository.delete(createdUser.id);
      expect(result).toBe(true);

      // Verify user is actually deleted
      const foundUser = await userRepository.findById(createdUser.id);
      expect(foundUser).toBeUndefined();
    });
  });
});
