import express from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireCsrfToken } from '../../middleware/csrf';
import type { SessionUser } from '../../types/api';
import { isSingleUserMode } from '../../utils/env';

export const whoamiRouter = express.Router();

interface WhoamiResponse {
  userName: string;
  userRole: string;
  singleUserMode: boolean;
}

whoamiRouter.get(
  '/',
  requireCsrfToken,
  requireAuth,
  (req: express.Request, res: express.Response<WhoamiResponse>) => {
    const user = req.user as SessionUser;
    res.json({
      userName: user.userName,
      userRole: user.userRole,
      singleUserMode: isSingleUserMode()
    });
  }
);
