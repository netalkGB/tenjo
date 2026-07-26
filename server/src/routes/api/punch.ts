import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import { type SessionUser, typedHandler } from '../../types/api';
import { HttpError } from '../../errors/HttpError';
import { punchSkillService } from '../../services/registry';
import {
  PunchSkillNotFoundError,
  PunchSkillValidationError,
  PunchSkillConflictError,
  PUNCH_ZIP_MAX_SIZE
} from '../../services/PunchSkillService';

export const punchRouter = express.Router();

const updateSkillSchema = z.object({
  enabled: z.boolean()
});

function mapPunchError(err: unknown): never {
  if (err instanceof PunchSkillNotFoundError) {
    throw new HttpError(StatusCodes.NOT_FOUND, err.message);
  }
  if (err instanceof PunchSkillValidationError) {
    throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
  }
  if (err instanceof PunchSkillConflictError) {
    throw new HttpError(StatusCodes.CONFLICT, err.message);
  }
  throw err;
}

/*
 * GET /api/punch/skills
 * List Punch skills for the current user.
 * When pageSize is provided, results are paginated.
 * When pageSize is omitted, all matching skills are returned (no LIMIT).
 * Supports ?search=, ?enabled=all|enabled|disabled, ?pageSize=, ?pageNumber=.
 */
interface ListSkillsRequest {
  query: {
    search?: string;
    enabled?: string;
    pageSize?: string;
    pageNumber?: string;
  };
}

function parseEnabledFilter(
  value: string | undefined
): 'all' | 'enabled' | 'disabled' {
  if (value === 'enabled' || value === 'disabled') {
    return value;
  }
  return 'all';
}

function mapSkillToJson(s: {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    enabled: s.enabled,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

punchRouter.get(
  '/skills',
  requireAuth,
  typedHandler<ListSkillsRequest>(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const { search, enabled, pageSize, pageNumber } = req.query;
    const listOptions = {
      search: search || undefined,
      enabled: parseEnabledFilter(enabled)
    };

    if (pageSize === undefined) {
      const skills = await punchSkillService.list(sessionUser.id, listOptions);
      res.json({
        skills: skills.map(mapSkillToJson),
        totalPages: 1,
        currentPage: 1,
        totalCount: skills.length
      });
      return;
    }

    const result = await punchSkillService.findPaginated(
      sessionUser.id,
      parseInt(pageSize, 10) || 15,
      parseInt(pageNumber ?? '', 10) || 1,
      listOptions
    );

    res.json({
      skills: result.skills.map(mapSkillToJson),
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalCount: result.totalCount
    });
  })
);

/*
 * GET /api/punch/skills/enabled
 * List enabled skills (name + description) for slash autocomplete / agent UI.
 */
punchRouter.get(
  '/skills/enabled',
  requireAuth,
  typedHandler(async (req, res) => {
    const sessionUser = req.user as SessionUser;
    const skills = await punchSkillService.listEnabled(sessionUser.id);
    res.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description
      }))
    });
  })
);

/*
 * POST /api/punch/import
 * Import a skill package from a ZIP (raw body + x-filename).
 */
punchRouter.post(
  '/import',
  requireCsrfToken,
  requireAuth,
  express.raw({ type: '*/*', limit: PUNCH_ZIP_MAX_SIZE }),
  async (req: express.Request, res: express.Response) => {
    try {
      const sessionUser = req.user as SessionUser;
      const rawFilename = req.headers['x-filename'];
      const filename =
        typeof rawFilename === 'string'
          ? decodeURIComponent(rawFilename)
          : 'skill.zip';
      const fileBuffer = req.body as Buffer;

      const skill = await punchSkillService.importFromZip(
        sessionUser.id,
        fileBuffer,
        filename
      );
      res.status(StatusCodes.CREATED).json({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at
      });
    } catch (err) {
      mapPunchError(err);
    }
  }
);

/*
 * PATCH /api/punch/skills/:id
 * Enable or disable a skill.
 */
interface PatchSkillRequest {
  params: { id: string };
}

punchRouter.patch(
  '/skills/:id',
  requireCsrfToken,
  requireAuth,
  typedHandler<PatchSkillRequest>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const parseResult = updateSkillSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'Invalid request body',
          parseResult.error.issues.map((e) => e.message)
        );
      }
      const skill = await punchSkillService.setEnabled(
        req.params.id,
        sessionUser.id,
        parseResult.data.enabled
      );
      res.json({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at
      });
    } catch (err) {
      mapPunchError(err);
    }
  })
);

/*
 * DELETE /api/punch/skills/:id
 */
interface DeleteSkillRequest {
  params: { id: string };
}

punchRouter.delete(
  '/skills/:id',
  requireCsrfToken,
  requireAuth,
  typedHandler<DeleteSkillRequest>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      await punchSkillService.delete(req.params.id, sessionUser.id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      mapPunchError(err);
    }
  })
);
