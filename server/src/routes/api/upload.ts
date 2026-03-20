import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import { typedHandler } from '../../types/api';
import {
  ImageService,
  ImageNotFoundError,
  ImageValidationError,
  type UploadResult
} from '../../services/ImageService';
import { HttpError } from '../../errors/HttpError';

export const uploadRouter = express.Router();

const imageService = new ImageService();

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/*
 * POST /api/upload/image
 * Upload a single image file, validate, and return the artifact path
 */
uploadRouter.post(
  '/image',
  requireCsrfToken,
  requireAuth,
  express.raw({ type: '*/*', limit: MAX_FILE_SIZE }),
  async (req: express.Request, res: express.Response<UploadResult>) => {
    try {
      const fileBuffer = req.body as Buffer;
      const result = await imageService.uploadImage(fileBuffer);
      res.json(result);
    } catch (err) {
      if (err instanceof ImageValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  }
);

/*
 * GET /api/upload/artifacts/:filename
 * Serve uploaded artifact files
 */
interface GetArtifactRequest {
  params: { filename: string };
}

uploadRouter.get(
  '/artifacts/:filename',
  typedHandler<GetArtifactRequest>(async (req, res) => {
    try {
      const { filename } = req.params;
      const { data, contentType } = await imageService.getArtifact(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(data);
    } catch (err) {
      if (err instanceof ImageNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      throw err;
    }
  })
);
