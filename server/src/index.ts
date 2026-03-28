import 'source-map-support/register'; // Enable source map support for better error stack traces
import express from 'express';
import path from 'node:path';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { csrfMiddleware } from './middleware/csrf';
import { requestLogger } from './middleware/requestLogger';
import {
  getSessionSecret,
  isSingleUserMode,
  getDatabaseSchema,
  getDatabaseUrl
} from './utils/env';
import { sessionUserMiddleware } from './middleware/sessionUser';
import { setupRoutes } from './routes';
import { unexpectedErrorHandler } from './middleware/unexpectedErrorHandler';
import { toolApprovalEmitter } from './services/ToolApprovalEmitter';
import logger from './logger';
import { pool } from './db/client';
import { ensureDatabaseExists, runMigrations } from './db/runMigration';

const PgStore = connectPgSimple(session);

const app = express();
const host = process.env.LISTEN_HOST || '0.0.0.0';
const port = parseInt(process.env.LISTEN_PORT || '3000', 10);

app.set('view engine', 'ejs');
app.set('views', [
  // .views: generated from client build (overwritten on each build)
  path.join(__dirname, '../.views'),
  // views: server-owned templates (e.g. OAuth callback) that persist across builds
  path.join(__dirname, '../views')
]);
app.use('/assets', express.static(path.join(__dirname, '../.static')));
app.use(express.static(path.join(__dirname, '../.public')));

app.use(requestLogger);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
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
  })
);

// Populate req.user from session
app.use(sessionUserMiddleware);

// CSRF middleware (runs on all routes)
app.use(csrfMiddleware);

setupRoutes(app);

// Global error handler (must be registered after routes)
app.use(unexpectedErrorHandler);

app.get('/{*splat}', (_req, res) => {
  res.render('index');
});

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    // Ensure database and schema exist, then run migrations
    await ensureDatabaseExists(getDatabaseUrl());
    const schemaName = getDatabaseSchema();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    const migrationCount = await runMigrations(pool);
    logger.info(`Applied ${migrationCount} migration(s)`);

    // Clear sessions on startup in single user mode
    if (isSingleUserMode()) {
      try {
        await pool.query(`DELETE FROM "${schemaName}"."session"`);
        logger.info('Single user mode: sessions cleared');
      } catch {
        // Session table may not exist yet on first startup
        logger.info(
          'Single user mode: session table not found, skipping clear'
        );
      }
    }

    await toolApprovalEmitter.start();
    app.listen(port, host, () => {
      logger.info(`Server running on ${host}:${port}`);
    });

    const shutdown = () => {
      logger.info('Shutting down...');
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })();
}

export { app };
// Exported for Electron main process to call OAuth callback directly (bypassing HTTP)
export { mcpOAuthService } from './services/registry';
export type {
  OAuthCallbackParams,
  OAuthCallbackResult
} from './services/McpOAuthService';
