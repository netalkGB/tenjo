import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isSingleUserMode } from '../utils/env';
import { HttpError } from '../errors/HttpError';

export const requireMultiUserMode = (
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (isSingleUserMode()) {
    next(
      new HttpError(
        StatusCodes.FORBIDDEN,
        'This endpoint is not available in single user mode'
      )
    );
    return;
  }
  next();
};
