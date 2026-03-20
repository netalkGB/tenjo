import type {
  ThreadRepository,
  Thread,
  PaginatedThreadsResult
} from '../repositories/ThreadRepository';
import type { MessageRepository } from '../repositories/MessageRepository';
import { ServiceError } from '../errors/ServiceError';

export class ThreadNotFoundError extends ServiceError {
  constructor(message: string = 'Thread not found') {
    super(message);
  }
}

export class ThreadValidationError extends ServiceError {}

export class ThreadOperationError extends ServiceError {}

export class ThreadService {
  constructor(
    private threadRepo: ThreadRepository,
    private messageRepo: MessageRepository
  ) {}

  async verifyThreadOwnership(
    threadId: string,
    userId: string
  ): Promise<Thread> {
    const thread = await this.threadRepo.findByIdAndUser(threadId, userId);
    if (!thread) {
      throw new ThreadNotFoundError();
    }
    return thread;
  }

  async createThread(userId: string): Promise<Thread | undefined> {
    return this.threadRepo.create({
      title: '',
      created_by: userId,
      updated_by: userId
    });
  }

  async renameThread(
    threadId: string,
    userId: string,
    title: string
  ): Promise<Thread> {
    if (!title || title.trim().length === 0) {
      throw new ThreadValidationError('Title is required');
    }

    await this.verifyThreadOwnership(threadId, userId);

    const updatedThread = await this.threadRepo.update(threadId, {
      title: title.trim()
    });

    if (!updatedThread) {
      throw new ThreadOperationError('Failed to update thread');
    }

    return updatedThread;
  }

  async deleteThread(threadId: string, userId: string): Promise<void> {
    await this.verifyThreadOwnership(threadId, userId);

    await this.messageRepo.deleteByThreadId(threadId);

    const deleted = await this.threadRepo.delete(threadId);
    if (!deleted) {
      throw new ThreadOperationError('Failed to delete thread');
    }
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    lastThreadId?: string,
    searchWord?: string
  ): Promise<PaginatedThreadsResult> {
    return this.threadRepo.findPaginated(
      userId,
      pageSize,
      pageNumber,
      lastThreadId,
      searchWord
    );
  }

  async findPinned(userId: string): Promise<Thread[]> {
    return this.threadRepo.findPinned(userId);
  }

  async togglePin(
    threadId: string,
    userId: string,
    pinned: boolean
  ): Promise<Thread> {
    if (typeof pinned !== 'boolean') {
      throw new ThreadValidationError('pinned must be a boolean');
    }

    await this.verifyThreadOwnership(threadId, userId);

    const updatedThread = await this.threadRepo.pin(threadId, pinned);

    if (!updatedThread) {
      throw new ThreadOperationError('Failed to update pin status');
    }

    return updatedThread;
  }
}
