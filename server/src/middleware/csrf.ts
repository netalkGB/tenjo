import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { isDevelopment } from '../utils/env';
import { HttpError } from '../errors/HttpError';
import logger from '../logger';

export const csrfMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const generateCsrfToken = () => {
    return crypto.randomBytes(32).toString('hex');
  };

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }

  res.locals.csrfToken = req.session.csrfToken;
  next();
};

export const requireCsrfToken = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (isDevelopment()) {
    next();
    return;
  }

  const token =
    req.body?._csrf ||
    req.headers['csrf-token'] ||
    req.headers['x-csrf-token'] ||
    req.query._csrf;

  if (!token || token !== req.session.csrfToken) {
    logger.warn(
      `CSRF validation failed from ${req.ip} for ${req.method} ${req.path}`
    );
    // Return 401 instead of 403 to trigger authentication flow
    // CSRF token mismatch typically indicates session expiry
    next(
      new HttpError(StatusCodes.UNAUTHORIZED, 'CSRF token validation failed')
    );
    return;
  }

  next();
};
