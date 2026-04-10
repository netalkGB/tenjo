import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import { type SessionUser, typedHandler } from '../../types/api';
import { HttpError } from '../../errors/HttpError';
import { knowledgeService } from '../../services/registry';
import {
  KnowledgeNotFoundError,
  KnowledgeValidationError,
  KNOWLEDGE_MAX_FILE_SIZE
} from '../../services/KnowledgeService';

export const knowledgeRouter = express.Router();

const createKnowledgeSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string()
});

const updateKnowledgeSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string()
});

/*
 * GET /api/knowledge
 * List knowledge entries for the current user with pagination.
 * Supports ?search=, ?pageSize=, ?pageNumber= query params.
 */
interface ListKnowledgeRequest {
  query: {
    search?: string;
    pageSize?: string;
    pageNumber?: string;
  };
}

knowledgeRouter.get(
  '/',
  requireAuth,
  typedHandler<ListKnowledgeRequest>(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { search, pageSize, pageNumber } = req.query;

    const result = await knowledgeService.findPaginated(
      sessionUser.id,
      parseInt(pageSize ?? '', 10) || 15,
      parseInt(pageNumber ?? '', 10) || 1,
      search || undefined
    );

    res.json(result);
  })
);

/*
 * GET /api/knowledge/:id/content
 * Get the content of a knowledge entry.
 */
interface GetContentRequest {
  params: { id: string };
}

interface GetContentResponse {
  content: string;
}

knowledgeRouter.get(
  '/:id/content',
  requireAuth,
  typedHandler<GetContentRequest, GetContentResponse>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { id } = req.params;

      const content = await knowledgeService.getContent(id, sessionUser.id);
      res.json({ content });
    } catch (err) {
      if (err instanceof KnowledgeNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      throw err;
    }
  })
);

/*
 * POST /api/knowledge
 * Create a new knowledge entry from JSON body.
 */
knowledgeRouter.post(
  '/',
  requireCsrfToken,
  requireAuth,
  typedHandler(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;

      const parseResult = createKnowledgeSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'Invalid request body',
          parseResult.error.issues.map((e) => e.message)
        );
      }

      const { name, content } = parseResult.data;
      const knowledge = await knowledgeService.create(
        sessionUser.id,
        name,
        content
      );
      res.status(StatusCodes.CREATED).json(knowledge);
    } catch (err) {
      if (err instanceof KnowledgeValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  })
);

/*
 * POST /api/knowledge/upload
 * Upload a knowledge file as raw binary.
 * File name is taken from the x-filename header (URL-encoded).
 */
knowledgeRouter.post(
  '/upload',
  requireCsrfToken,
  requireAuth,
  express.raw({ type: '*/*', limit: KNOWLEDGE_MAX_FILE_SIZE }),
  async (req: express.Request, res: express.Response) => {
    try {
      const sessionUser = req.user as SessionUser;

      const rawFilename = req.headers['x-filename'];
      if (!rawFilename || typeof rawFilename !== 'string') {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'x-filename header is required'
        );
      }

      const name = decodeURIComponent(rawFilename);
      const fileBuffer = req.body as Buffer;

      const knowledge = await knowledgeService.upload(
        sessionUser.id,
        name,
        fileBuffer
      );
      res.status(StatusCodes.CREATED).json(knowledge);
    } catch (err) {
      if (err instanceof KnowledgeValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  }
);

/*
 * PUT /api/knowledge/:id
 * Update an existing knowledge entry.
 */
interface UpdateKnowledgeRequest {
  params: { id: string };
}

knowledgeRouter.put(
  '/:id',
  requireCsrfToken,
  requireAuth,
  typedHandler<UpdateKnowledgeRequest>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { id } = req.params;

      const parseResult = updateKnowledgeSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'Invalid request body',
          parseResult.error.issues.map((e) => e.message)
        );
      }

      const { name, content } = parseResult.data;
      const knowledge = await knowledgeService.update(
        id,
        sessionUser.id,
        name,
        content
      );
      res.json(knowledge);
    } catch (err) {
      if (err instanceof KnowledgeNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      if (err instanceof KnowledgeValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  })
);

/*
 * DELETE /api/knowledge/:id
 * Delete a knowledge entry.
 */
interface DeleteKnowledgeRequest {
  params: { id: string };
}

knowledgeRouter.delete(
  '/:id',
  requireCsrfToken,
  requireAuth,
  typedHandler<DeleteKnowledgeRequest>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { id } = req.params;

      await knowledgeService.delete(id, sessionUser.id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      if (err instanceof KnowledgeNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      throw err;
    }
  })
);
