import type { Request, Response, NextFunction } from 'express';

/**
 * Copies req.session.user onto req.user for request handlers.
 */
export const sessionUserMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (req.session?.user) {
    req.user = req.session.user;
  }
  next();
};
