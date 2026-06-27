import logger from '../logger';

const DEFAULT_IDLE_STOP_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

function readIdleStopMs(): number {
  const raw = process.env.AGENT_IDLE_STOP_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_STOP_MS;
}

interface IdleReaperDeps {
  isActive: (projectId: string) => boolean;
  hasViewer: (projectId: string) => boolean;
  stop: (projectId: string) => Promise<void>;
}

const lastActivityByProjectId = new Map<string, number>();
let dependencies: IdleReaperDeps | null = null;
let timer: NodeJS.Timeout | null = null;
let idleStopMs = DEFAULT_IDLE_STOP_MS;

/** Register or refresh a project's activity. */
export function touch(projectId: string): void {
  lastActivityByProjectId.set(projectId, Date.now());
}

/** Start the periodic idle-project sweep. */
export function startIdleReaper(injected: IdleReaperDeps): void {
  dependencies = injected;
  idleStopMs = readIdleStopMs();
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void sweep();
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info('[agent-idle] idle pod-stop reaper started', { idleStopMs });
}

/** Stop the periodic idle-project sweep. */
export function stopIdleReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function isProjectInUse(
  projectId: string,
  activeDeps: IdleReaperDeps
): boolean {
  return activeDeps.isActive(projectId) || activeDeps.hasViewer(projectId);
}

function hasExceededIdleWindow(now: number, lastSeenAt: number): boolean {
  return now - lastSeenAt > idleStopMs;
}

async function sweep(): Promise<void> {
  if (!dependencies) {
    return;
  }
  const now = Date.now();
  for (const [projectId, lastSeenAt] of [
    ...lastActivityByProjectId.entries()
  ]) {
    if (isProjectInUse(projectId, dependencies)) {
      lastActivityByProjectId.set(projectId, now);
      continue;
    }
    if (!hasExceededIdleWindow(now, lastSeenAt)) {
      continue;
    }
    lastActivityByProjectId.delete(projectId);
    try {
      await dependencies.stop(projectId);
    } catch (error) {
      logger.error('[agent-idle] failed to stop idle project pod', {
        projectId,
        error
      });
    }
  }
}
