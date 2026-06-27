import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from '../db/client';
import { getSessionSecret } from '../utils/env';

const PgStore = connectPgSimple(session);

/**
 * The express-session middleware, in its own module so that BOTH the regular
 * HTTP pipeline (index.ts) and the WebSocket upgrade path (vncRelay.ts — an
 * `upgrade` event never runs the app middleware chain) authenticate requests
 * through the exact same session store and cookie.
 */
export const sessionMiddleware = session({
  // Session table ("session") is auto-created in the schema set by the pool's search_path
  store: new PgStore({
    pool,
    createTableIfMissing: true
  }),
  secret: getSessionSecret() || 'fallback-secret-key-change-this',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // Set to true in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});
