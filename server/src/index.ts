import 'source-map-support/register'; // Enable source map support for better error stack traces
import express from 'express';
import path from 'node:path';
import { csrfMiddleware } from './middleware/csrf';
import { requestLogger } from './middleware/requestLogger';
import {
  isSingleUserMode,
  getDatabaseSchema,
  getDatabaseUrl
} from './utils/env';
import { sessionMiddleware } from './middleware/session';
import { sessionUserMiddleware } from './middleware/sessionUser';
import { setupRoutes } from './routes';
import { unexpectedErrorHandler } from './middleware/unexpectedErrorHandler';
import { generationAbortRegistry } from './registries/GenerationAbortRegistry';
import {
  agentEventBus,
  globalSettingService,
  questionEmitter,
  toolApprovalEmitter
} from './services/registry';
import { agentSessionService } from './services/AgentSessionService';
import {
  initAgentSandbox,
  sandboxManager
} from './services/AgentSandboxService';
import { attachVncRelay, hasVncViewer } from './relays/vncRelay';
import { attachAgentEventRelay } from './relays/agentEventRelay';
import { startIdleReaper } from './services/AgentIdleReaperService';
import { agentProjectRepo } from './repositories/registry';
import logger from './logger';
import { pool } from './db/client';
import { ensureDatabaseExists, runMigrations } from './db/runMigration';

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
app.use(express.json({ limit: '256kb' }));

app.use(sessionMiddleware);

// Populate req.user from session
app.use(sessionUserMiddleware);

// CSRF middleware (runs on all routes)
app.use(csrfMiddleware);

setupRoutes(app);

// Global error handler (must be registered after routes)
app.use(unexpectedErrorHandler);

app.get('/{*splat}', async (_req, res) => {
  let appTitle = 'Tenjo';
  let faviconHref = '/logo.svg';
  try {
    const branding = await globalSettingService.getBrandingSettings();
    if (branding.appTitle) {
      appTitle = branding.appTitle;
    }
    if (branding.faviconFilename) {
      faviconHref = '/api/settings/branding/favicon';
    }
  } catch (err) {
    logger.warn('Failed to load branding for index render', { error: err });
  }
  res.render('index', { appTitle, faviconHref });
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
    await questionEmitter.start();
    await generationAbortRegistry.start();
    await agentEventBus.start();
    await agentSessionService.start();
    // Probe Docker + FULLY pre-warm the sandbox (image, container, toolchain) in
    // the background so the first agent task doesn't pay the minutes-long
    // first-run build. Not awaited — the HTTP server starts immediately; the UI
    // reflects progress via the sandbox-status endpoint/SSE.
    void initAgentSandbox();
    // Stop a project's pod after a stretch with no agent activity AND no preview
    // viewer, freeing CPU/RAM; the pod resumes (files intact) on next use.
    startIdleReaper({
      isActive: (projectId) => agentSessionService.isProjectActive(projectId),
      hasViewer: (projectId) => hasVncViewer(projectId),
      stop: async (projectId) => {
        const project = await agentProjectRepo.findById(projectId);
        if (project) {
          await sandboxManager.stopProject(project.id);
        }
      }
    });

    const server = app.listen(port, host, () => {
      logger.info(`Server running on ${host}:${port}`);
    });
    // VNC preview WebSocket relay (the `upgrade` event lives on the raw server).
    attachAgentEventRelay(server);
    attachVncRelay(server);

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
