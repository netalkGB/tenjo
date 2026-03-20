import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MessageRepository } from '../MessageRepository';
import { UserRepository } from '../UserRepository';
import { ThreadRepository } from '../ThreadRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('MessageRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let messageRepository: MessageRepository;
  let userRepository: UserRepository;
  let threadRepository: ThreadRepository;
  let testUserId: string;
  let testThreadId: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'message' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    messageRepository = new MessageRepository(pool);
    userRepository = new UserRepository(pool);
    threadRepository = new ThreadRepository(pool);
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

    // Create a test thread for foreign key references
    const thread = await threadRepository.create({
      title: 'Test Thread',
      created_by: testUserId,
      updated_by: testUserId
    });
    testThreadId = thread!.id;
  });

  describe('create', () => {
    it('should create a new message', async () => {
      const messageData = {
        thread_id: testThreadId,
        parent_message_id: '00000000-0000-0000-0000-000000000002',
        data: {},
        source: 'user' as const,
        created_by: testUserId,
        updated_by: testUserId
      };
      const message = await messageRepository.create(messageData);
      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.thread_id).toBe(messageData.thread_id);
      expect(message.parent_message_id).toBe(messageData.parent_message_id);
      expect(message.data).toEqual({});
      expect(message.source).toBe('user');
      expect(message.created_by).toBe(testUserId);
    });
  });

  describe('addMessage', () => {
    it('should correctly build message chain with 4 messages', async () => {
      // Message 1: Root message (user)
      const message1 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'First user message' },
        source: 'user' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Message 2: Assistant reply to message 1
      const message2 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: message1.id,
        data: { content: 'First assistant reply' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Message 3: User reply to message 2
      const message3 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: message2.id,
        data: { content: 'Second user message' },
        source: 'user' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Message 4: Assistant reply to message 3
      const message4 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: message3.id,
        data: { content: 'Second assistant reply' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Verify message 1
      const updatedMessage1 = await messageRepository.findById(message1.id);
      expect(updatedMessage1).toBeDefined();
      expect(updatedMessage1?.parent_message_id).toBeNull();
      expect(updatedMessage1?.selected_child_id).toBe(message2.id);
      expect(updatedMessage1?.data).toEqual({ content: 'First user message' });
      expect(updatedMessage1?.source).toBe('user');

      // Verify message 2
      const updatedMessage2 = await messageRepository.findById(message2.id);
      expect(updatedMessage2).toBeDefined();
      expect(updatedMessage2?.parent_message_id).toBe(message1.id);
      expect(updatedMessage2?.selected_child_id).toBe(message3.id);
      expect(updatedMessage2?.data).toEqual({
        content: 'First assistant reply'
      });
      expect(updatedMessage2?.source).toBe('assistant');

      // Verify message 3
      const updatedMessage3 = await messageRepository.findById(message3.id);
      expect(updatedMessage3).toBeDefined();
      expect(updatedMessage3?.parent_message_id).toBe(message2.id);
      expect(updatedMessage3?.selected_child_id).toBe(message4.id);
      expect(updatedMessage3?.data).toEqual({ content: 'Second user message' });
      expect(updatedMessage3?.source).toBe('user');

      // Verify message 4
      const updatedMessage4 = await messageRepository.findById(message4.id);
      expect(updatedMessage4).toBeDefined();
      expect(updatedMessage4?.parent_message_id).toBe(message3.id);
      expect(updatedMessage4?.selected_child_id).toBeNull();
      expect(updatedMessage4?.data).toEqual({
        content: 'Second assistant reply'
      });
      expect(updatedMessage4?.source).toBe('assistant');

      // Verify thread's current_leaf_message_id
      const updatedThread = await threadRepository.findById(testThreadId);
      expect(updatedThread).toBeDefined();
      expect(updatedThread?.current_leaf_message_id).toBe(message4.id);
      expect(updatedThread?.updated_by).toBe(testUserId);
    });

    it('should update parent selected_child_id when adding multiple children (branch)', async () => {
      // Create parent message
      const parent = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Parent message' },
        source: 'user' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Add first child
      const child1 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: parent.id,
        data: { content: 'First child' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Verify parent points to child1
      const parentAfterChild1 = await messageRepository.findById(parent.id);
      expect(parentAfterChild1?.selected_child_id).toBe(child1.id);

      // Verify thread points to child1
      const threadAfterChild1 = await threadRepository.findById(testThreadId);
      expect(threadAfterChild1?.current_leaf_message_id).toBe(child1.id);

      // Add second child (same parent - creating a branch)
      const child2 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: parent.id,
        data: { content: 'Second child' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Verify parent now points to child2 (most recent child)
      const parentAfterChild2 = await messageRepository.findById(parent.id);
      expect(parentAfterChild2?.selected_child_id).toBe(child2.id);

      // Verify thread now points to child2 (most recent leaf)
      const threadAfterChild2 = await threadRepository.findById(testThreadId);
      expect(threadAfterChild2?.current_leaf_message_id).toBe(child2.id);

      // Verify both children exist and have correct parent
      const verifiedChild1 = await messageRepository.findById(child1.id);
      expect(verifiedChild1?.parent_message_id).toBe(parent.id);
      expect(verifiedChild1?.data).toEqual({ content: 'First child' });

      const verifiedChild2 = await messageRepository.findById(child2.id);
      expect(verifiedChild2?.parent_message_id).toBe(parent.id);
      expect(verifiedChild2?.data).toEqual({ content: 'Second child' });
    });
  });

  describe('findAll', () => {
    it('should return an empty array when no messages exist', async () => {
      const messages = await messageRepository.findAll();
      expect(messages).toEqual([]);
    });

    it('should return all messages', async () => {
      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Message 1' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Message 2' },
        source: 'assistant',
        created_by: testUserId,
        updated_by: testUserId
      });

      const messages = await messageRepository.findAll();

      expect(messages).toHaveLength(2);
      expect(messages[0].data).toEqual({ content: 'Message 1' });
      expect(messages[1].data).toEqual({ content: 'Message 2' });
    });
  });

  describe('findById', () => {
    it('should return undefined when message does not exist', async () => {
      const message = await messageRepository.findById(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(message).toBeUndefined();
    });

    it('should return message when message exists', async () => {
      const createdMessage = await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Test message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const foundMessage = await messageRepository.findById(createdMessage.id);

      expect(foundMessage).toBeDefined();
      expect(foundMessage?.id).toBe(createdMessage.id);
      expect(foundMessage?.data).toEqual({ content: 'Test message' });
      expect(foundMessage?.source).toBe('user');
    });
  });

  describe('update', () => {
    it('should return undefined when message does not exist', async () => {
      const result = await messageRepository.update(
        '00000000-0000-0000-0000-000000000000',
        { data: { content: 'Updated' } }
      );
      expect(result).toBeUndefined();
    });

    it('should update message when message exists', async () => {
      const createdMessage = await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Original message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const updatedMessage = await messageRepository.update(createdMessage.id, {
        data: { content: 'Updated message' },
        source: 'assistant'
      });

      expect(updatedMessage).toBeDefined();
      expect(updatedMessage?.id).toBe(createdMessage.id);
      expect(updatedMessage?.data).toEqual({ content: 'Updated message' });
      expect(updatedMessage?.source).toBe('assistant');
    });

    it('should update only specified fields', async () => {
      const createdMessage = await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Original message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const updatedMessage = await messageRepository.update(createdMessage.id, {
        source: 'assistant'
      });

      expect(updatedMessage).toBeDefined();
      expect(updatedMessage?.source).toBe('assistant');
      expect(updatedMessage?.data).toEqual({ content: 'Original message' }); // Should remain unchanged
    });
  });

  describe('delete', () => {
    it('should return false when message does not exist', async () => {
      const result = await messageRepository.delete(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBe(false);
    });

    it('should delete message and return true when message exists', async () => {
      const createdMessage = await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Test message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const result = await messageRepository.delete(createdMessage.id);
      expect(result).toBe(true);

      // Verify message is actually deleted
      const foundMessage = await messageRepository.findById(createdMessage.id);
      expect(foundMessage).toBeUndefined();
    });
  });

  describe('deleteByThreadId', () => {
    it('should return 0 when no messages exist in thread', async () => {
      const count = await messageRepository.deleteByThreadId(testThreadId);
      expect(count).toBe(0);
    });

    it('should delete all messages in the thread and return count', async () => {
      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Message 1' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Message 2' },
        source: 'assistant',
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Message 3' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const count = await messageRepository.deleteByThreadId(testThreadId);
      expect(count).toBe(3);

      const remaining = await messageRepository.findAll();
      expect(remaining).toHaveLength(0);
    });

    it('should only delete messages in the specified thread', async () => {
      const otherThread = await threadRepository.create({
        title: 'Other Thread',
        created_by: testUserId,
        updated_by: testUserId
      });

      await messageRepository.create({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Thread 1 message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        thread_id: otherThread!.id,
        parent_message_id: null,
        data: { content: 'Thread 2 message' },
        source: 'user',
        created_by: testUserId,
        updated_by: testUserId
      });

      const count = await messageRepository.deleteByThreadId(testThreadId);
      expect(count).toBe(1);

      const remaining = await messageRepository.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].thread_id).toBe(otherThread!.id);
    });
  });

  describe('findPath', () => {
    const createDummyRecords = async (
      messageIds: string[],
      threadId: string
    ): Promise<void> => {
      for (const id of messageIds) {
        await messageRepository.create({
          id,
          source: 'user',
          data: {},
          parent_message_id: null,
          thread_id: threadId,
          created_by: testUserId,
          updated_by: testUserId
        });
      }
    };

    it('should return messages traced from thread last_leaf to both past and future(p1)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        '58918fe0-81b2-46e9-b356-29682d0d7621',
        'ae8ef2f9-b2a1-4102-9423-1666389d52b2',
        'bf2258f6-e1a9-4dee-8cad-2baf3f13b798',
        'b417a9fc-135f-4763-b6bf-677a8feff58c',
        'da205cd3-f91d-45b5-9533-c5467c10975d',
        '6c141029-0096-457b-88cf-0d74fd9c9577'
      ];
      // Create all messages with dummy data
      await createDummyRecords(messageIdList, threadId);

      // Update with correct data
      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[2],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[3],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });

      const resultMessageList = await messageRepository.findPath(
        messageIdList[1]
      );

      expect(resultMessageList.length).toBe(6);
      expect(resultMessageList[0].id).toBe(messageIdList[0]);
      expect(resultMessageList[1].id).toBe(messageIdList[1]);
      expect(resultMessageList[2].id).toBe(messageIdList[2]);
      expect(resultMessageList[3].id).toBe(messageIdList[3]);
      expect(resultMessageList[4].id).toBe(messageIdList[4]);
      expect(resultMessageList[5].id).toBe(messageIdList[5]);
    });

    it('should return messages traced from thread last_leaf to both past and future(p2)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        '55687737-8355-49aa-8493-92edd50f1bc1',
        '3690117a-aa27-4d23-9d4c-0eaf5b7df011',
        'afbdb7e5-4ae0-4c02-9e9e-bba7803f01d6',
        '629b1ef5-11b0-4e9d-99ba-d0f3a3499a37',
        'aff57a66-df59-4ef2-8248-1c3fa6b21ca6',
        'e7f3b94b-b60d-4699-b5c2-9494732cd32d',
        '80acdab7-91bc-4e74-8179-e6c7292788b6',
        'd872ce99-a4f7-48d6-8646-0954cf97d2f8',
        'b1d6e686-9c3b-44b3-9333-e024a8262f24',
        'abb9329d-ddf0-4839-b7c7-d9c7b5202508',
        '9f75e459-83e8-48d7-bc62-708922c12cc4',
        '59f99d75-1792-49e8-9775-4f3c45fb9bf6'
      ];
      // Create all messages with dummy data
      await createDummyRecords(messageIdList, threadId);

      // Update with correct data
      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[2],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[6],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 7
      await messageRepository.update(messageIdList[6], {
        source: 'user',
        data: { content: 'ア' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[7],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 8
      await messageRepository.update(messageIdList[7], {
        source: 'assistant',
        data: { content: 'ア' },
        parent_message_id: messageIdList[6],
        selected_child_id: messageIdList[8],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 9
      await messageRepository.update(messageIdList[8], {
        source: 'user',
        data: { content: 'イ' },
        parent_message_id: messageIdList[7],
        selected_child_id: messageIdList[9],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 10
      await messageRepository.update(messageIdList[9], {
        source: 'assistant',
        data: { content: 'イ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[10],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 11
      await messageRepository.update(messageIdList[10], {
        source: 'user',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[9],
        selected_child_id: messageIdList[11],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 12
      await messageRepository.update(messageIdList[11], {
        source: 'assistant',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[10],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });

      const resultMessageList = await messageRepository.findPath(
        messageIdList[11]
      );

      expect(resultMessageList.length).toBe(8);
      expect(resultMessageList[0].id).toBe(messageIdList[0]);
      expect(resultMessageList[1].id).toBe(messageIdList[1]);
      expect(resultMessageList[2].id).toBe(messageIdList[6]);
      expect(resultMessageList[3].id).toBe(messageIdList[7]);
      expect(resultMessageList[4].id).toBe(messageIdList[8]);
      expect(resultMessageList[5].id).toBe(messageIdList[9]);
      expect(resultMessageList[6].id).toBe(messageIdList[10]);
      expect(resultMessageList[7].id).toBe(messageIdList[11]);
    });

    it('should return messages traced from thread last_leaf to both past and future(p3)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        'c652456d-b3e4-4749-8713-bf36608d4045',
        '5e2c8bd0-9905-4c3c-b461-f9924b7c3096',
        '100ec57f-3492-4c12-bdc6-dd704455d8f0',
        '4a847073-bac3-4f50-a87f-28dfbb15d3a9',
        '28279935-7b9a-44f5-bd72-da84d1c59811',
        'c68746da-8bf4-4ca5-ba62-e431147f7203',
        '0779eda2-4d4d-4c48-922f-9e3683727e36',
        '6f9420fe-90c1-4941-ab72-4b461291d06a',
        '0b299155-23cd-418b-b6b0-f0b8606898ce',
        'c2ff2ab2-d68e-41fd-bbab-8ac199c6f306',
        'd49739b8-82e8-403f-a601-43c6b8311313',
        '2266465d-389d-4377-b4f3-5abebb5ca949',
        '63ce3785-3901-4417-9586-cb85e1b618dd',
        '2509a668-32b3-46bb-8ebe-bd1d47a4cb8c',
        '59d2dd8a-5912-45d6-a851-d872b60655ad'
      ];
      // Create all messages with dummy data
      await createDummyRecords(messageIdList, threadId);

      // Update with correct data
      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[6],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[3],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 7
      await messageRepository.update(messageIdList[6], {
        source: 'user',
        data: { content: 'ア' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[7],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 8
      await messageRepository.update(messageIdList[7], {
        source: 'assistant',
        data: { content: 'ア' },
        parent_message_id: messageIdList[6],
        selected_child_id: messageIdList[8],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 9
      await messageRepository.update(messageIdList[8], {
        source: 'user',
        data: { content: 'イ' },
        parent_message_id: messageIdList[7],
        selected_child_id: messageIdList[9],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 10
      await messageRepository.update(messageIdList[9], {
        source: 'assistant',
        data: { content: 'イ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[12],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 11
      await messageRepository.update(messageIdList[10], {
        source: 'user',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[9],
        selected_child_id: messageIdList[11],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 12
      await messageRepository.update(messageIdList[11], {
        source: 'assistant',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[10],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 13
      await messageRepository.update(messageIdList[12], {
        source: 'assistant',
        data: { content: 'エ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[13],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });

      // 14
      await messageRepository.update(messageIdList[13], {
        source: 'user',
        data: { content: 'オ' },
        parent_message_id: messageIdList[12],
        selected_child_id: messageIdList[14],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });
      // 15
      await messageRepository.update(messageIdList[14], {
        source: 'assistant',
        data: { content: 'オ' },
        parent_message_id: messageIdList[13],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });

      const resultMessageList = await messageRepository.findPath(
        messageIdList[14]
      );

      expect(resultMessageList.length).toBe(8);
      expect(resultMessageList[0].id).toBe(messageIdList[0]);
      expect(resultMessageList[1].id).toBe(messageIdList[1]);
      expect(resultMessageList[2].id).toBe(messageIdList[6]);
      expect(resultMessageList[3].id).toBe(messageIdList[7]);
      expect(resultMessageList[4].id).toBe(messageIdList[8]);
      expect(resultMessageList[5].id).toBe(messageIdList[12]);
      expect(resultMessageList[6].id).toBe(messageIdList[13]);
      expect(resultMessageList[7].id).toBe(messageIdList[14]);
    });
  });

  describe('switchBranch', () => {
    it('should update parent selected_child_id to target child', async () => {
      const parent = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: null,
        data: { content: 'Parent' },
        source: 'user' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      const child1 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: parent.id,
        data: { content: 'Child 1' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      const child2 = await messageRepository.addMessage({
        thread_id: testThreadId,
        parent_message_id: parent.id,
        data: { content: 'Child 2' },
        source: 'assistant' as const,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Parent points to child2 (most recent)
      const parentBefore = await messageRepository.findById(parent.id);
      expect(parentBefore?.selected_child_id).toBe(child2.id);

      // Switch to child1
      await messageRepository.switchBranch(parent.id, child1.id);

      const parentAfter = await messageRepository.findById(parent.id);
      expect(parentAfter?.selected_child_id).toBe(child1.id);
    });
  });

  describe('getBranchStatus', () => {
    const createDummyRecords = async (
      messageIds: string[],
      threadId: string
    ): Promise<void> => {
      for (const id of messageIds) {
        await messageRepository.create({
          id,
          source: 'user',
          data: {},
          parent_message_id: null,
          thread_id: threadId,
          created_by: testUserId,
          updated_by: testUserId
        });
      }
    };

    it('should return null when parentId is empty string', async () => {
      const result = await messageRepository.getBranchStatus('');
      expect(result).toBeNull();
    });

    it('should return null when parent has no children', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = ['58918fe0-81b2-46e9-b356-29682d0d7621'];
      await createDummyRecords(messageIdList, threadId);

      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date(),
        updated_at: new Date()
      });

      const result = await messageRepository.getBranchStatus(messageIdList[0]);
      expect(result).toBeNull();
    });

    it('should return correct branch status for single branch (p1)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        '58918fe0-81b2-46e9-b356-29682d0d7621',
        'ae8ef2f9-b2a1-4102-9423-1666389d52b2',
        'bf2258f6-e1a9-4dee-8cad-2baf3f13b798'
      ];
      await createDummyRecords(messageIdList, threadId);

      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z')
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[2],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:01:00Z'),
        updated_at: new Date('2024-01-01T00:01:00Z')
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:02:00Z'),
        updated_at: new Date('2024-01-01T00:02:00Z')
      });

      // messageIdList[0] has only 1 child
      const result = await messageRepository.getBranchStatus(messageIdList[0]);
      expect(result).toEqual({
        current: 1,
        total: 1,
        siblings: [messageIdList[1]]
      });
    });

    it('should return correct branch status with multiple branches (p2)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        '55687737-8355-49aa-8493-92edd50f1bc1',
        '3690117a-aa27-4d23-9d4c-0eaf5b7df011',
        'afbdb7e5-4ae0-4c02-9e9e-bba7803f01d6',
        '629b1ef5-11b0-4e9d-99ba-d0f3a3499a37',
        'aff57a66-df59-4ef2-8248-1c3fa6b21ca6',
        'e7f3b94b-b60d-4699-b5c2-9494732cd32d',
        '80acdab7-91bc-4e74-8179-e6c7292788b6',
        'd872ce99-a4f7-48d6-8646-0954cf97d2f8',
        'b1d6e686-9c3b-44b3-9333-e024a8262f24',
        'abb9329d-ddf0-4839-b7c7-d9c7b5202508',
        '9f75e459-83e8-48d7-bc62-708922c12cc4',
        '59f99d75-1792-49e8-9775-4f3c45fb9bf6'
      ];
      await createDummyRecords(messageIdList, threadId);

      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z')
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[2],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:01:00Z'),
        updated_at: new Date('2024-01-01T00:01:00Z')
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[6],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:02:00Z'),
        updated_at: new Date('2024-01-01T00:02:00Z')
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:03:00Z'),
        updated_at: new Date('2024-01-01T00:03:00Z')
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:04:00Z'),
        updated_at: new Date('2024-01-01T00:04:00Z')
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:05:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z')
      });
      // 7
      await messageRepository.update(messageIdList[6], {
        source: 'user',
        data: { content: 'ア' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[7],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:06:00Z'),
        updated_at: new Date('2024-01-01T00:06:00Z')
      });
      // 8
      await messageRepository.update(messageIdList[7], {
        source: 'assistant',
        data: { content: 'ア' },
        parent_message_id: messageIdList[6],
        selected_child_id: messageIdList[8],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:07:00Z'),
        updated_at: new Date('2024-01-01T00:07:00Z')
      });
      // 9
      await messageRepository.update(messageIdList[8], {
        source: 'user',
        data: { content: 'イ' },
        parent_message_id: messageIdList[7],
        selected_child_id: messageIdList[9],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:08:00Z'),
        updated_at: new Date('2024-01-01T00:08:00Z')
      });
      // 10
      await messageRepository.update(messageIdList[9], {
        source: 'assistant',
        data: { content: 'イ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[10],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:09:00Z'),
        updated_at: new Date('2024-01-01T00:09:00Z')
      });
      // 11
      await messageRepository.update(messageIdList[10], {
        source: 'user',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[9],
        selected_child_id: messageIdList[11],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:10:00Z'),
        updated_at: new Date('2024-01-01T00:10:00Z')
      });
      // 12
      await messageRepository.update(messageIdList[11], {
        source: 'assistant',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[10],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:11:00Z'),
        updated_at: new Date('2024-01-01T00:11:00Z')
      });

      const path = await messageRepository.findPath(messageIdList[11]);
      for (let i = 0; i < path.length; i++) {
        const result = await messageRepository.getBranchStatus(
          path[i]?.parent_message_id,
          path[i]?.id
        );
        switch (i) {
          case 0:
            // If the first item has only 1 sibling, return 1/1
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [messageIdList[0]]
            });
            break;
          case 2:
            // path[2] has a branch (children of messageIdList[1]: [2] and [6])
            expect(result).toEqual({
              current: 2,
              total: 2,
              siblings: [messageIdList[2], messageIdList[6]]
            });
            break;
          default:
            // No other branches (1/1)
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [path[i]?.id]
            });
            break;
        }
      }
    });

    it('should return correct branch status with complex branches (p3)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        'c652456d-b3e4-4749-8713-bf36608d4045',
        '5e2c8bd0-9905-4c3c-b461-f9924b7c3096',
        '100ec57f-3492-4c12-bdc6-dd704455d8f0',
        '4a847073-bac3-4f50-a87f-28dfbb15d3a9',
        '28279935-7b9a-44f5-bd72-da84d1c59811',
        'c68746da-8bf4-4ca5-ba62-e431147f7203',
        '0779eda2-4d4d-4c48-922f-9e3683727e36',
        '6f9420fe-90c1-4941-ab72-4b461291d06a',
        '0b299155-23cd-418b-b6b0-f0b8606898ce',
        'c2ff2ab2-d68e-41fd-bbab-8ac199c6f306',
        'd49739b8-82e8-403f-a601-43c6b8311313',
        '2266465d-389d-4377-b4f3-5abebb5ca949',
        '63ce3785-3901-4417-9586-cb85e1b618dd',
        '2509a668-32b3-46bb-8ebe-bd1d47a4cb8c',
        '59d2dd8a-5912-45d6-a851-d872b60655ad'
      ];
      await createDummyRecords(messageIdList, threadId);

      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z')
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[6],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:01:00Z'),
        updated_at: new Date('2024-01-01T00:01:00Z')
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[3],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:02:00Z'),
        updated_at: new Date('2024-01-01T00:02:00Z')
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:03:00Z'),
        updated_at: new Date('2024-01-01T00:03:00Z')
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:04:00Z'),
        updated_at: new Date('2024-01-01T00:04:00Z')
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:05:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z')
      });
      // 7
      await messageRepository.update(messageIdList[6], {
        source: 'user',
        data: { content: 'ア' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[7],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:06:00Z'),
        updated_at: new Date('2024-01-01T00:06:00Z')
      });
      // 8
      await messageRepository.update(messageIdList[7], {
        source: 'assistant',
        data: { content: 'ア' },
        parent_message_id: messageIdList[6],
        selected_child_id: messageIdList[8],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:07:00Z'),
        updated_at: new Date('2024-01-01T00:07:00Z')
      });
      // 9
      await messageRepository.update(messageIdList[8], {
        source: 'user',
        data: { content: 'イ' },
        parent_message_id: messageIdList[7],
        selected_child_id: messageIdList[9],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:08:00Z'),
        updated_at: new Date('2024-01-01T00:08:00Z')
      });
      // 10
      await messageRepository.update(messageIdList[9], {
        source: 'assistant',
        data: { content: 'イ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[12],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:09:00Z'),
        updated_at: new Date('2024-01-01T00:09:00Z')
      });
      // 11
      await messageRepository.update(messageIdList[10], {
        source: 'user',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[9],
        selected_child_id: messageIdList[11],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:10:00Z'),
        updated_at: new Date('2024-01-01T00:10:00Z')
      });
      // 12
      await messageRepository.update(messageIdList[11], {
        source: 'assistant',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[10],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:11:00Z'),
        updated_at: new Date('2024-01-01T00:11:00Z')
      });
      // 13
      await messageRepository.update(messageIdList[12], {
        source: 'assistant',
        data: { content: 'エ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[13],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:12:00Z'),
        updated_at: new Date('2024-01-01T00:12:00Z')
      });

      // 14
      await messageRepository.update(messageIdList[13], {
        source: 'user',
        data: { content: 'オ' },
        parent_message_id: messageIdList[12],
        selected_child_id: messageIdList[14],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:13:00Z'),
        updated_at: new Date('2024-01-01T00:13:00Z')
      });
      // 15
      await messageRepository.update(messageIdList[14], {
        source: 'assistant',
        data: { content: 'オ' },
        parent_message_id: messageIdList[13],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:14:00Z'),
        updated_at: new Date('2024-01-01T00:14:00Z')
      });

      const path = await messageRepository.findPath(messageIdList[14]);
      for (let i = 0; i < path.length; i++) {
        const result = await messageRepository.getBranchStatus(
          path[i]?.parent_message_id,
          path[i]?.id
        );
        switch (i) {
          case 0:
            // If the first item has only 1 sibling, return 1/1
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [messageIdList[0]]
            });
            break;
          case 2:
            // path[2] has a branch (children of messageIdList[1]: [2] and [6])
            expect(result).toEqual({
              current: 2,
              total: 2,
              siblings: [messageIdList[2], messageIdList[6]]
            });
            break;
          case 5:
            // path[5] has a branch (children of messageIdList[8]: [9] and [12])
            expect(result).toEqual({
              current: 2,
              total: 2,
              siblings: [messageIdList[9], messageIdList[12]]
            });
            break;
          default:
            // No other branches (1/1)
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [path[i]?.id]
            });
            break;
        }
      }
    });

    it('should return correct branch status with complex branches (p4)', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        'c652456d-b3e4-4749-8713-bf36608d4045',
        '5e2c8bd0-9905-4c3c-b461-f9924b7c3096',
        '100ec57f-3492-4c12-bdc6-dd704455d8f0',
        '4a847073-bac3-4f50-a87f-28dfbb15d3a9',
        '28279935-7b9a-44f5-bd72-da84d1c59811',
        'c68746da-8bf4-4ca5-ba62-e431147f7203',
        '0779eda2-4d4d-4c48-922f-9e3683727e36',
        '6f9420fe-90c1-4941-ab72-4b461291d06a',
        '0b299155-23cd-418b-b6b0-f0b8606898ce',
        'c2ff2ab2-d68e-41fd-bbab-8ac199c6f306',
        'd49739b8-82e8-403f-a601-43c6b8311313',
        '2266465d-389d-4377-b4f3-5abebb5ca949',
        '63ce3785-3901-4417-9586-cb85e1b618dd',
        '2509a668-32b3-46bb-8ebe-bd1d47a4cb8c',
        '59d2dd8a-5912-45d6-a851-d872b60655ad'
      ];
      await createDummyRecords(messageIdList, threadId);

      // 1
      await messageRepository.update(messageIdList[0], {
        source: 'user',
        data: { content: 'A' },
        parent_message_id: null,
        selected_child_id: messageIdList[1],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z')
      });
      // 2
      await messageRepository.update(messageIdList[1], {
        source: 'assistant',
        data: { content: 'A' },
        parent_message_id: messageIdList[0],
        selected_child_id: messageIdList[6],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:01:00Z'),
        updated_at: new Date('2024-01-01T00:01:00Z')
      });
      // 3
      await messageRepository.update(messageIdList[2], {
        source: 'user',
        data: { content: 'B' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[3],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:02:00Z'),
        updated_at: new Date('2024-01-01T00:02:00Z')
      });
      // 4
      await messageRepository.update(messageIdList[3], {
        source: 'assistant',
        data: { content: 'B' },
        parent_message_id: messageIdList[2],
        selected_child_id: messageIdList[4],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:03:00Z'),
        updated_at: new Date('2024-01-01T00:03:00Z')
      });
      // 5
      await messageRepository.update(messageIdList[4], {
        source: 'user',
        data: { content: 'C' },
        parent_message_id: messageIdList[3],
        selected_child_id: messageIdList[5],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:04:00Z'),
        updated_at: new Date('2024-01-01T00:04:00Z')
      });
      // 6
      await messageRepository.update(messageIdList[5], {
        source: 'assistant',
        data: { content: 'C' },
        parent_message_id: messageIdList[4],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:05:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z')
      });
      // 7
      await messageRepository.update(messageIdList[6], {
        source: 'user',
        data: { content: 'ア' },
        parent_message_id: messageIdList[1],
        selected_child_id: messageIdList[7],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:06:00Z'),
        updated_at: new Date('2024-01-01T00:06:00Z')
      });
      // 8
      await messageRepository.update(messageIdList[7], {
        source: 'assistant',
        data: { content: 'ア' },
        parent_message_id: messageIdList[6],
        selected_child_id: messageIdList[8],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:07:00Z'),
        updated_at: new Date('2024-01-01T00:07:00Z')
      });
      // 9
      await messageRepository.update(messageIdList[8], {
        source: 'user',
        data: { content: 'イ' },
        parent_message_id: messageIdList[7],
        selected_child_id: messageIdList[9],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:08:00Z'),
        updated_at: new Date('2024-01-01T00:08:00Z')
      });
      // 10
      await messageRepository.update(messageIdList[9], {
        source: 'assistant',
        data: { content: 'イ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[10],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:09:00Z'),
        updated_at: new Date('2024-01-01T00:09:00Z')
      });
      // 11
      await messageRepository.update(messageIdList[10], {
        source: 'user',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[9],
        selected_child_id: messageIdList[11],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:10:00Z'),
        updated_at: new Date('2024-01-01T00:10:00Z')
      });
      // 12
      await messageRepository.update(messageIdList[11], {
        source: 'assistant',
        data: { content: 'ウ' },
        parent_message_id: messageIdList[10],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:11:00Z'),
        updated_at: new Date('2024-01-01T00:11:00Z')
      });
      // 13
      await messageRepository.update(messageIdList[12], {
        source: 'assistant',
        data: { content: 'エ' },
        parent_message_id: messageIdList[8],
        selected_child_id: messageIdList[13],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:12:00Z'),
        updated_at: new Date('2024-01-01T00:12:00Z')
      });

      // 14
      await messageRepository.update(messageIdList[13], {
        source: 'user',
        data: { content: 'オ' },
        parent_message_id: messageIdList[12],
        selected_child_id: messageIdList[14],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:13:00Z'),
        updated_at: new Date('2024-01-01T00:13:00Z')
      });
      // 15
      await messageRepository.update(messageIdList[14], {
        source: 'assistant',
        data: { content: 'オ' },
        parent_message_id: messageIdList[13],
        selected_child_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId,
        created_at: new Date('2024-01-01T00:14:00Z'),
        updated_at: new Date('2024-01-01T00:14:00Z')
      });

      const path = await messageRepository.findPath(messageIdList[11]);
      for (let i = 0; i < path.length; i++) {
        const result = await messageRepository.getBranchStatus(
          path[i]?.parent_message_id,
          path[i]?.id
        );
        switch (i) {
          case 0:
            // If the first item has only 1 sibling, return 1/1
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [messageIdList[0]]
            });
            break;
          case 2:
            // path[2] has a branch (children of messageIdList[1]: [2] and [6])
            expect(result).toEqual({
              current: 2,
              total: 2,
              siblings: [messageIdList[2], messageIdList[6]]
            });
            break;
          case 5:
            // path[5] has a branch (children of messageIdList[8]: [9] and [12], current is [9]=1/2)
            expect(result).toEqual({
              current: 1,
              total: 2,
              siblings: [messageIdList[9], messageIdList[12]]
            });
            break;
          default:
            // No other branches (1/1)
            expect(result).toEqual({
              current: 1,
              total: 1,
              siblings: [path[i]?.id]
            });
            break;
        }
      }
    });

    it('should fall back to latest sibling when selected_child_id is invalid and no currentChildId', async () => {
      const thread = await threadRepository.create({
        title: 'TEST',
        created_by: testUserId,
        updated_by: testUserId
      });
      const threadId = thread!.id;
      const messageIdList = [
        'aa000000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000002',
        'aa000000-0000-0000-0000-000000000003'
      ];

      // Create parent and two children
      await messageRepository.create({
        id: messageIdList[0],
        source: 'user',
        data: { content: 'Parent' },
        parent_message_id: null,
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        id: messageIdList[1],
        source: 'assistant',
        data: { content: 'Child 1' },
        parent_message_id: messageIdList[0],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId
      });
      await messageRepository.create({
        id: messageIdList[2],
        source: 'assistant',
        data: { content: 'Child 2' },
        parent_message_id: messageIdList[0],
        thread_id: threadId,
        created_by: testUserId,
        updated_by: testUserId
      });

      // Set parent's selected_child_id to a non-existent UUID (simulating deleted child)
      await messageRepository.update(messageIdList[0], {
        selected_child_id: null
      });

      // Call without currentChildId — should fall back to latest sibling
      const result = await messageRepository.getBranchStatus(messageIdList[0]);

      expect(result).toBeDefined();
      expect(result!.total).toBe(2);
      // Falls back to last sibling (latest by created_at)
      expect(result!.current).toBe(2);
      expect(result!.siblings).toEqual([messageIdList[1], messageIdList[2]]);
    });
  });
});
