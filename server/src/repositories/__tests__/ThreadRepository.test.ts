import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ThreadRepository } from '../ThreadRepository';
import { UserRepository } from '../UserRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('ThreadRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let threadRepository: ThreadRepository;
  let userRepository: UserRepository;
  let testUserId: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'thread' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    threadRepository = new ThreadRepository(pool);
    userRepository = new UserRepository(pool);
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();

    // Create a test user for foreign key references
    const user = await userRepository.create({
      full_name: 'Test User',
      user_name: 'testuser',
      email: 'test@example.com',
      password: 'test_password'
    });
    testUserId = user.id;
  });

  describe('create', () => {
    it('should create a new thread', async () => {
      const threadData = {
        title: 'Test Thread',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      };

      const thread = await threadRepository.create(threadData);

      expect(thread).toBeDefined();
      expect(thread!.id).toBeDefined();
      expect(thread!.title).toBe(threadData.title);
      expect(thread!.current_leaf_message_id).toBe(
        threadData.current_leaf_message_id
      );
      expect(thread!.created_by).toBe(testUserId);
    });

    it('should auto-generate an id for new threads', async () => {
      const thread1 = await threadRepository.create({
        title: 'Thread One',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const thread2 = await threadRepository.create({
        title: 'Thread Two',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000002',
        created_by: testUserId,
        updated_by: testUserId
      });

      expect(thread1!.id).toBeDefined();
      expect(thread2!.id).toBeDefined();
      expect(thread1!.id).not.toBe(thread2!.id);
    });
  });

  describe('findAll', () => {
    it('should return an empty array when no threads exist', async () => {
      const threads = await threadRepository.findAll();
      expect(threads).toEqual([]);
    });

    it('should return all threads', async () => {
      await threadRepository.create({
        title: 'Thread One',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });
      await threadRepository.create({
        title: 'Thread Two',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000002',
        created_by: testUserId,
        updated_by: testUserId
      });

      const threads = await threadRepository.findAll();

      expect(threads).toHaveLength(2);
      expect(threads[0].title).toBe('Thread One');
      expect(threads[1].title).toBe('Thread Two');
    });
  });

  describe('findById', () => {
    it('should return undefined when thread does not exist', async () => {
      const thread = await threadRepository.findById(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(thread).toBeUndefined();
    });

    it('should return thread when thread exists', async () => {
      const createdThread = await threadRepository.create({
        title: 'Test Thread',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const foundThread = await threadRepository.findById(createdThread!.id);

      expect(foundThread).toBeDefined();
      expect(foundThread!.id).toBe(createdThread!.id);
      expect(foundThread!.title).toBe('Test Thread');
      expect(foundThread!.current_leaf_message_id).toBe(
        '00000000-0000-0000-0000-000000000001'
      );
    });
  });

  describe('findByIdAndUser', () => {
    it('should return undefined when thread does not exist', async () => {
      const thread = await threadRepository.findByIdAndUser(
        '00000000-0000-0000-0000-000000000000',
        testUserId
      );
      expect(thread).toBeUndefined();
    });

    it('should return undefined when thread exists but belongs to another user', async () => {
      const otherUser = await userRepository.create({
        full_name: 'Other User',
        user_name: 'other',
        email: 'other@example.com',
        password: 'other_password'
      });

      const thread = await threadRepository.create({
        title: 'Other Thread',
        created_by: otherUser.id,
        updated_by: otherUser.id
      });

      const result = await threadRepository.findByIdAndUser(
        thread!.id,
        testUserId
      );
      expect(result).toBeUndefined();
    });

    it('should return thread when id and user match', async () => {
      const thread = await threadRepository.create({
        title: 'My Thread',
        created_by: testUserId,
        updated_by: testUserId
      });

      const result = await threadRepository.findByIdAndUser(
        thread!.id,
        testUserId
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe(thread!.id);
      expect(result!.title).toBe('My Thread');
      expect(result!.created_by).toBe(testUserId);
    });
  });

  describe('update', () => {
    it('should return undefined when thread does not exist', async () => {
      const result = await threadRepository.update(
        '00000000-0000-0000-0000-000000000000',
        { title: 'Updated Title' }
      );
      expect(result).toBeUndefined();
    });

    it('should update thread when thread exists', async () => {
      const createdThread = await threadRepository.create({
        title: 'Original Title',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const updatedThread = await threadRepository.update(createdThread!.id, {
        title: 'Updated Title',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000002'
      });

      expect(updatedThread).toBeDefined();
      expect(updatedThread!.id).toBe(createdThread!.id);
      expect(updatedThread!.title).toBe('Updated Title');
      expect(updatedThread!.current_leaf_message_id).toBe(
        '00000000-0000-0000-0000-000000000002'
      );
    });

    it('should update only specified fields', async () => {
      const createdThread = await threadRepository.create({
        title: 'Original Title',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const updatedThread = await threadRepository.update(createdThread!.id, {
        title: 'New Title'
      });

      expect(updatedThread).toBeDefined();
      expect(updatedThread!.title).toBe('New Title');
      expect(updatedThread!.current_leaf_message_id).toBe(
        '00000000-0000-0000-0000-000000000001'
      ); // Should remain unchanged
    });
  });

  describe('delete', () => {
    it('should return false when thread does not exist', async () => {
      const result = await threadRepository.delete(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBe(false);
    });

    it('should delete thread and return true when thread exists', async () => {
      const createdThread = await threadRepository.create({
        title: 'Test Thread',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const result = await threadRepository.delete(createdThread!.id);
      expect(result).toBe(true);

      // Verify thread is actually deleted
      const foundThread = await threadRepository.findById(createdThread!.id);
      expect(foundThread).toBeUndefined();
    });
  });

  describe('pin', () => {
    it('should unpin a thread', async () => {
      const thread = await threadRepository.create({
        title: 'Test Thread',
        created_by: testUserId,
        updated_by: testUserId
      });

      await threadRepository.pin(thread!.id, true);
      const unpinnedThread = await threadRepository.pin(thread!.id, false);

      expect(unpinnedThread).toBeDefined();
      expect(unpinnedThread!.pinned).toBe(false);
    });

    it('should return undefined when thread does not exist', async () => {
      const result = await threadRepository.pin(
        '00000000-0000-0000-0000-000000000000',
        true
      );
      expect(result).toBeUndefined();
    });
  });

  describe('findPinned', () => {
    it('should return empty array when no pinned threads exist', async () => {
      await threadRepository.create({
        title: 'Unpinned Thread',
        created_by: testUserId,
        updated_by: testUserId
      });

      const pinned = await threadRepository.findPinned(testUserId);
      expect(pinned).toEqual([]);
    });

    it('should return only pinned threads', async () => {
      const thread1 = await threadRepository.create({
        title: 'Pinned Thread 1',
        created_by: testUserId,
        updated_by: testUserId
      });
      await threadRepository.create({
        title: 'Unpinned Thread',
        created_by: testUserId,
        updated_by: testUserId
      });
      const thread3 = await threadRepository.create({
        title: 'Pinned Thread 2',
        created_by: testUserId,
        updated_by: testUserId
      });

      await threadRepository.pin(thread1!.id, true);
      await threadRepository.pin(thread3!.id, true);

      const pinned = await threadRepository.findPinned(testUserId);

      expect(pinned).toHaveLength(2);
      expect(pinned[0].title).toBe('Pinned Thread 2'); // Most recent first
      expect(pinned[1].title).toBe('Pinned Thread 1');
    });

    it('should only return pinned threads for the specified user', async () => {
      const otherUser = await userRepository.create({
        full_name: 'Other User',
        user_name: 'other',
        email: 'other@example.com',
        password: 'other_password'
      });

      const myThread = await threadRepository.create({
        title: 'My Pinned Thread',
        created_by: testUserId,
        updated_by: testUserId
      });
      const otherThread = await threadRepository.create({
        title: 'Other Pinned Thread',
        created_by: otherUser.id,
        updated_by: otherUser.id
      });

      await threadRepository.pin(myThread!.id, true);
      await threadRepository.pin(otherThread!.id, true);

      const myPinned = await threadRepository.findPinned(testUserId);
      expect(myPinned).toHaveLength(1);
      expect(myPinned[0].title).toBe('My Pinned Thread');

      const otherPinned = await threadRepository.findPinned(otherUser.id);
      expect(otherPinned).toHaveLength(1);
      expect(otherPinned[0].title).toBe('Other Pinned Thread');
    });
  });

  describe('findPaginated', () => {
    it('should return empty result when no threads exist', async () => {
      const result = await threadRepository.findPaginated(testUserId, 10, 1);

      expect(result.threads).toEqual([]);
      expect(result.totalPages).toBe(0);
      expect(result.currentPage).toBe(1);
      expect(result.totalCount).toBe(0);
    });

    it('should handle pagination correctly with 5 threads and 2 items per page', async () => {
      for (let i = 1; i <= 5; i++) {
        await threadRepository.create({
          title: `Thread ${i}`,
          current_leaf_message_id: `00000000-0000-0000-0000-00000000000${i}`,
          created_by: testUserId,
          updated_by: testUserId
        });
      }

      // Get first page (2 items per page)
      const page1 = await threadRepository.findPaginated(testUserId, 2, 1);
      expect(page1.threads).toHaveLength(2);
      expect(page1.totalPages).toBe(3);
      expect(page1.currentPage).toBe(1);
      expect(page1.totalCount).toBe(5);
      expect(page1.threads[0].title).toBe('Thread 5'); // Most recent

      // Get second page
      const page2 = await threadRepository.findPaginated(testUserId, 2, 2);
      expect(page2.threads).toHaveLength(2);
      expect(page2.currentPage).toBe(2);
      expect(page2.threads[0].title).toBe('Thread 3');

      // Get third page (only 1 item)
      const page3 = await threadRepository.findPaginated(testUserId, 2, 3);
      expect(page3.threads).toHaveLength(1);
      expect(page3.currentPage).toBe(3);
      expect(page3.threads[0].title).toBe('Thread 1'); // Oldest
    });

    it('should return single page when all threads fit', async () => {
      const thread1 = await threadRepository.create({
        title: 'Thread 1',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      const thread2 = await threadRepository.create({
        title: 'Thread 2',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000002',
        created_by: testUserId,
        updated_by: testUserId
      });

      const thread3 = await threadRepository.create({
        title: 'Thread 3',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000003',
        created_by: testUserId,
        updated_by: testUserId
      });

      const result = await threadRepository.findPaginated(testUserId, 10, 1);

      expect(result.threads).toHaveLength(3);
      expect(result.threads[0].id).toBe(thread3!.id); // Most recent first
      expect(result.threads[1].id).toBe(thread2!.id);
      expect(result.threads[2].id).toBe(thread1!.id);
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
      expect(result.totalCount).toBe(3);
    });

    it('should filter threads by search word', async () => {
      await threadRepository.create({
        title: 'React Tutorial',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000001',
        created_by: testUserId,
        updated_by: testUserId
      });

      await threadRepository.create({
        title: 'Vue.js Guide',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000002',
        created_by: testUserId,
        updated_by: testUserId
      });

      await threadRepository.create({
        title: 'React Advanced',
        current_leaf_message_id: '00000000-0000-0000-0000-000000000003',
        created_by: testUserId,
        updated_by: testUserId
      });

      // Search for "React"
      const result = await threadRepository.findPaginated(
        testUserId,
        10,
        1,
        undefined,
        'React'
      );

      expect(result.threads).toHaveLength(2);
      expect(result.threads[0].title).toBe('React Advanced');
      expect(result.threads[1].title).toBe('React Tutorial');
      expect(result.totalCount).toBe(2);

      // Search with empty string should return all
      const allResult = await threadRepository.findPaginated(
        testUserId,
        10,
        1,
        undefined,
        ''
      );
      expect(allResult.threads).toHaveLength(3);
      expect(allResult.totalCount).toBe(3);
    });

    it('should return threads older than lastThreadId when specified', async () => {
      const threads = [];
      for (let i = 1; i <= 5; i++) {
        const thread = await threadRepository.create({
          title: `Thread ${i}`,
          created_by: testUserId,
          updated_by: testUserId
        });
        // Set distinct timestamps to ensure deterministic ordering
        await threadRepository.update(thread!.id, {
          created_at: new Date(`2024-01-0${i}T00:00:00Z`)
        });
        const updated = await threadRepository.findById(thread!.id);
        threads.push(updated!);
      }

      // Use threads[3] (Thread 4) as the cursor — should return threads older than Thread 4
      const result = await threadRepository.findPaginated(
        testUserId,
        10,
        1,
        threads[3].id
      );

      expect(result.threads).toHaveLength(3);
      expect(result.threads[0].title).toBe('Thread 3');
      expect(result.threads[1].title).toBe('Thread 2');
      expect(result.threads[2].title).toBe('Thread 1');
      expect(result.totalCount).toBe(5);
    });

    it('should return empty array when lastThreadId does not exist', async () => {
      await threadRepository.create({
        title: 'Thread 1',
        created_by: testUserId,
        updated_by: testUserId
      });

      const result = await threadRepository.findPaginated(
        testUserId,
        10,
        1,
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.threads).toHaveLength(0);
      expect(result.totalCount).toBe(1);
    });

    it('should combine lastThreadId with search word', async () => {
      const titles = [
        'React Basics',
        'Vue Guide',
        'React Hooks',
        'React Advanced',
        'Angular Intro'
      ];
      const threads = [];
      for (let i = 0; i < titles.length; i++) {
        const thread = await threadRepository.create({
          title: titles[i],
          created_by: testUserId,
          updated_by: testUserId
        });
        await threadRepository.update(thread!.id, {
          created_at: new Date(`2024-01-0${i + 1}T00:00:00Z`)
        });
        const updated = await threadRepository.findById(thread!.id);
        threads.push(updated!);
      }

      // Use "React Advanced" (threads[3]) as cursor, search for "React"
      const result = await threadRepository.findPaginated(
        testUserId,
        10,
        1,
        threads[3].id,
        'React'
      );

      expect(result.threads).toHaveLength(2);
      expect(result.threads[0].title).toBe('React Hooks');
      expect(result.threads[1].title).toBe('React Basics');
      expect(result.totalCount).toBe(3);
    });
  });
});
