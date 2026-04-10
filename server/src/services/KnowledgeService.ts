import crypto from 'node:crypto';
import path from 'node:path';
import { ServiceError } from '../errors/ServiceError';
import logger from '../logger';
import type {
  KnowledgeRepository,
  Knowledge,
  PaginatedKnowledgeResult
} from '../repositories/KnowledgeRepository';
import type { FileUploadService } from './FileUploadService';

export class KnowledgeNotFoundError extends ServiceError {
  constructor(message: string = 'Knowledge entry not found') {
    super(message);
  }
}

export class KnowledgeValidationError extends ServiceError {}

export const KNOWLEDGE_MAX_FILE_SIZE = 200 * 1024;

/**
 * Ensure the file name ends with .txt extension.
 */
function ensureTxtExtension(name: string): string {
  return name.endsWith('.txt') ? name : `${name}.txt`;
}

export class KnowledgeService {
  constructor(
    private readonly knowledgeRepo: KnowledgeRepository,
    private readonly fileUploadService: FileUploadService
  ) {}

  async list(userId: string): Promise<Knowledge[]> {
    return this.knowledgeRepo.findByUserId(userId);
  }

  async search(userId: string, query: string): Promise<Knowledge[]> {
    return this.knowledgeRepo.findByUserIdAndName(userId, query);
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    search?: string
  ): Promise<PaginatedKnowledgeResult> {
    return this.knowledgeRepo.findPaginated(
      userId,
      pageSize,
      pageNumber,
      search
    );
  }

  async getById(id: string, userId: string): Promise<Knowledge> {
    const knowledge = await this.knowledgeRepo.findById(id);
    if (!knowledge || knowledge.created_by !== userId) {
      throw new KnowledgeNotFoundError();
    }
    return knowledge;
  }

  async getContent(id: string, userId: string): Promise<string> {
    const knowledge = await this.getById(id, userId);
    return this.fileUploadService.readText(path.basename(knowledge.fs_path));
  }

  async getContentsByIds(
    ids: string[],
    userId: string
  ): Promise<Array<{ name: string; content: string }>> {
    const knowledgeEntries = await this.knowledgeRepo.findByIds(ids);
    const ownedEntries = knowledgeEntries.filter(
      (k) => k.created_by === userId
    );

    const results = await Promise.all(
      ownedEntries.map(async (entry) => {
        try {
          const content = await this.fileUploadService.readText(
            path.basename(entry.fs_path)
          );
          return { name: entry.name, content };
        } catch (err) {
          logger.warn('Failed to read knowledge file', {
            id: entry.id,
            fsPath: entry.fs_path,
            error: err
          });
          return null;
        }
      })
    );

    return results.filter(
      (r): r is { name: string; content: string } => r !== null
    );
  }

  async create(
    userId: string,
    name: string,
    content: string
  ): Promise<Knowledge> {
    const safeName = ensureTxtExtension(name);

    if (await this.knowledgeRepo.existsByUserIdAndExactName(userId, safeName)) {
      throw new KnowledgeValidationError(
        `Knowledge entry with name "${safeName}" already exists`
      );
    }

    const contentBytes = new TextEncoder().encode(content).length;
    if (contentBytes > KNOWLEDGE_MAX_FILE_SIZE) {
      throw new KnowledgeValidationError(
        `File size exceeds ${KNOWLEDGE_MAX_FILE_SIZE / 1024}KB limit`
      );
    }

    const filename = `${crypto.randomUUID()}.txt`;
    const fsPath = await this.fileUploadService.save(
      filename,
      content,
      'utf-8'
    );

    return this.knowledgeRepo.create({
      name: safeName,
      display_path: safeName,
      fs_path: fsPath,
      created_by: userId,
      updated_by: userId
    });
  }

  async upload(
    userId: string,
    name: string,
    fileBuffer: Buffer
  ): Promise<Knowledge> {
    if (fileBuffer.length > KNOWLEDGE_MAX_FILE_SIZE) {
      throw new KnowledgeValidationError(
        `File size exceeds ${KNOWLEDGE_MAX_FILE_SIZE / 1024}KB limit`
      );
    }

    const safeName = ensureTxtExtension(name);

    if (await this.knowledgeRepo.existsByUserIdAndExactName(userId, safeName)) {
      throw new KnowledgeValidationError(
        `Knowledge entry with name "${safeName}" already exists`
      );
    }

    const filename = `${crypto.randomUUID()}.txt`;
    const fsPath = await this.fileUploadService.save(filename, fileBuffer);

    return this.knowledgeRepo.create({
      name: safeName,
      display_path: safeName,
      fs_path: fsPath,
      created_by: userId,
      updated_by: userId
    });
  }

  async update(
    id: string,
    userId: string,
    name: string,
    content: string
  ): Promise<Knowledge> {
    const knowledge = await this.getById(id, userId);

    const contentBytes = new TextEncoder().encode(content).length;
    if (contentBytes > KNOWLEDGE_MAX_FILE_SIZE) {
      throw new KnowledgeValidationError(
        `File size exceeds ${KNOWLEDGE_MAX_FILE_SIZE / 1024}KB limit`
      );
    }

    const safeName = ensureTxtExtension(name);

    await this.fileUploadService.save(
      path.basename(knowledge.fs_path),
      content,
      'utf-8'
    );

    const updated = await this.knowledgeRepo.update(id, {
      name: safeName,
      display_path: safeName,
      updated_by: userId
    });

    if (!updated) {
      throw new KnowledgeNotFoundError();
    }

    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const knowledge = await this.getById(id, userId);

    // Delete DB record first (reversible), then file (irreversible)
    await this.knowledgeRepo.delete(id);

    await this.fileUploadService.delete(path.basename(knowledge.fs_path));
  }
}
