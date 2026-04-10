import type { Request, Response, NextFunction } from 'express';

export const useSse = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Transfer-Encoding', 'chunked');

  res.flushHeaders();
  next();
};
