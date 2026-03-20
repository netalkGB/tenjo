import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { SessionUser } from '../types/api';
import { HttpError } from '../errors/HttpError';

export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const sessionUser = req.user as SessionUser | undefined;

  if (!sessionUser || sessionUser.userRole !== 'admin') {
    next(new HttpError(StatusCodes.FORBIDDEN, 'Admin access required'));
    return;
  }

  next();
};
