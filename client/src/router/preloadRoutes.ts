let agentHomeRoutePromise: Promise<
  typeof import('@/pages/main/agent/agent-home')
> | null = null;
let agentTaskRoutePromise: Promise<
  typeof import('@/pages/main/agent/task/agent-task-page')
> | null = null;

export function preloadAgentHomeRoute(): Promise<
  typeof import('@/pages/main/agent/agent-home')
> {
  agentHomeRoutePromise ??= import('@/pages/main/agent/agent-home');
  return agentHomeRoutePromise;
}

export function preloadAgentTaskRoute(): Promise<
  typeof import('@/pages/main/agent/task/agent-task-page')
> {
  agentTaskRoutePromise ??= import('@/pages/main/agent/task/agent-task-page');
  return agentTaskRoutePromise;
}
