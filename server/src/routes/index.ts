import type { Application } from 'express';
import { apiRouter } from './api';

export function setupRoutes(app: Application) {
  app.use('/api', apiRouter);
}
