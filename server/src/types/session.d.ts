import 'express-session';
import type { SessionUser } from './api';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    user?: SessionUser;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
