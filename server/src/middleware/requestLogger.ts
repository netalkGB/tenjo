import type { Request, Response, NextFunction } from 'express';
import logger from '../logger';

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.on('finish', () => {
    const timestamp = new Date().toISOString();
    logger.info(
      `${timestamp} ${req.ip} "${req.method} ${req.originalUrl}" ${res.statusCode}`
    );
  });

  next();
};
