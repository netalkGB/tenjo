import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { HttpError } from '../../errors/HttpError';

export const logoutRouter = express.Router();

interface LogoutResponse {
  message: string;
}

logoutRouter.post(
  '/',
  requireCsrfToken,
  (
    req: express.Request,
    res: express.Response<LogoutResponse>,
    next: express.NextFunction
  ) => {
    req.session.destroy((err: Error | undefined) => {
      if (err) {
        next(new HttpError(StatusCodes.INTERNAL_SERVER_ERROR, 'Logout failed'));
        return;
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logout successful' });
    });
  }
);
