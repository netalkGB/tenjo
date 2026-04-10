import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  KnowledgeSchema,
  KnowledgePaginatedResponseSchema,
  KnowledgeContentResponseSchema
} from './schemas';
import type { Knowledge, KnowledgePaginatedResponse } from './schemas';

export type { Knowledge, KnowledgePaginatedResponse } from './schemas';

/**
 * Fetches all knowledge entries (no pagination), optionally filtered by search term.
 */
export async function getKnowledgeList(search?: string): Promise<Knowledge[]> {
  try {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    // Fetch all by requesting a large page size
    params.pageSize = '9999';
    const response = await axios.get('/api/knowledge', { params });
    const result = KnowledgePaginatedResponseSchema.parse(response.data);
    return result.entries;
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Fetches a paginated list of knowledge entries.
 */
export async function getKnowledgeListPaginated(
  pageNumber: number,
  pageSize: number,
  search?: string
): Promise<KnowledgePaginatedResponse> {
  try {
    const params: Record<string, string | number> = {
      pageNumber,
      pageSize
    };
    if (search) params.search = search;
    const response = await axios.get('/api/knowledge', { params });
    return KnowledgePaginatedResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Fetches the content of a specific knowledge entry.
 */
export async function getKnowledgeContent(id: string): Promise<string> {
  try {
    const response = await axios.get(`/api/knowledge/${id}/content`);
    const validated = KnowledgeContentResponseSchema.parse(response.data);
    return validated.content;
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Creates a new knowledge entry with text content.
 */
export async function createKnowledge(
  name: string,
  content: string
): Promise<Knowledge> {
  try {
    const response = await axios.post('/api/knowledge', { name, content });
    return KnowledgeSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Uploads a file as a new knowledge entry.
 */
export async function uploadKnowledge(
  name: string,
  file: File
): Promise<Knowledge> {
  try {
    const buffer = await file.arrayBuffer();
    const response = await axios.post('/api/knowledge/upload', buffer, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-filename': encodeURIComponent(name)
      }
    });
    return KnowledgeSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Updates an existing knowledge entry.
 */
export async function updateKnowledge(
  id: string,
  name: string,
  content: string
): Promise<Knowledge> {
  try {
    const response = await axios.put(`/api/knowledge/${id}`, { name, content });
    return KnowledgeSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Deletes a knowledge entry.
 */
export async function deleteKnowledge(id: string): Promise<void> {
  try {
    await axios.delete(`/api/knowledge/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}
