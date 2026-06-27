import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  ContextFileUploadResponseSchema,
  type ContextFileRef
} from './schemas';
import type { UploadProgress } from '../chat/upload';

/**
 * Upload a single context file (image, text, JSON, …) for the agent. Unlike the
 * chat image upload, any file type is accepted — the original name travels in
 * the URL-encoded `X-File-Name` header since the body is raw bytes. The server
 * later writes it into the sandbox `_uploads/` dir on submit.
 *
 * The body is always sent as `application/octet-stream`: the app-level
 * `express.json()` parser would otherwise consume (and reject) a real MIME like
 * `application/json` before the raw-body route handler runs.
 */
export async function uploadContextFile(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<ContextFileRef> {
  try {
    const buffer = await file.arrayBuffer();
    const response = await axios.post('/api/agent/context-files', buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name)
      },
      onUploadProgress: progressEvent => {
        if (onProgress && progressEvent.total) {
          onProgress({
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            percentage: Math.round(
              (progressEvent.loaded / progressEvent.total) * 100
            )
          });
        }
      }
    });
    return ContextFileUploadResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}
