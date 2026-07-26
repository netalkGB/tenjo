import { createBrowserRouter, redirect } from 'react-router';
import { ErrorFallback } from '@/components/error';
import { ApiError } from '@/api/errors/ApiError';
import { fetchWhoami } from '@/api/server/whoami';
import { getThreadMessages } from '@/api/server/chat';
import { preloadAgentHomeRoute, preloadAgentTaskRoute } from './preloadRoutes';

export const routes = createBrowserRouter([
  {
    path: '/',
    lazy: async () => {
      const { Main } = await import('@/layouts/main');
      return { Component: Main };
    },
    ErrorBoundary: ErrorFallback,
    HydrateFallback: () => null,
    loader: async ({ request }) => {
      try {
        return await fetchWhoami();
      } catch (_error) {
        const url = new URL(request.url);
        return redirect(`/login?redirect=${encodeURIComponent(url.pathname)}`);
      }
    },
    children: [
      {
        index: true,
        lazy: async () => {
          const { Home } = await import('@/pages/main/home');
          return { Component: Home };
        }
      },
      {
        path: '/settings',
        loader: () => redirect('/settings/general')
      },
      {
        path: '/settings/:category',
        lazy: async () => {
          const { Settings } = await import('@/pages/main/settings');
          return { Component: Settings };
        }
      },
      {
        path: '/knowledge',
        lazy: async () => {
          const { Knowledge } = await import('@/pages/main/knowledge');
          return { Component: Knowledge };
        }
      },
      {
        path: '/punch',
        lazy: async () => {
          const { Punch } = await import('@/pages/main/punch');
          return { Component: Punch };
        }
      },
      {
        path: '/chat',
        children: [
          {
            path: ':id',
            lazy: async () => {
              const { Chat } = await import('@/pages/main/chat/');
              return { Component: Chat };
            },
            loader: async ({ params }) => {
              if (!params.id) {
                throw new Response('Not Found', { status: 404 });
              }
              try {
                const data = await getThreadMessages(params.id);
                return {
                  threadId: params.id,
                  data
                };
              } catch (error) {
                if (error instanceof ApiError) {
                  // Missing thread or unusable id → full-page Not Found
                  const status =
                    error.code === 404 ||
                    error.code === 400 ||
                    error.code === null ||
                    (error.code !== null && error.code >= 500)
                      ? 404
                      : error.code;
                  throw new Response(
                    status === 404 ? 'Not Found' : error.message || 'Error',
                    { status }
                  );
                }
                throw error;
              }
            }
          }
        ]
      },
      {
        path: '/agent',
        children: [
          {
            index: true,
            lazy: async () => {
              const { AgentHome } = await preloadAgentHomeRoute();
              return { Component: AgentHome };
            }
          },
          {
            path: 'task/:id',
            lazy: async () => {
              const { AgentTaskPage } = await preloadAgentTaskRoute();
              return { Component: AgentTaskPage };
            }
          }
        ]
      }
    ]
  },
  {
    path: '/login',
    lazy: async () => {
      const { Login } = await import('@/pages/login/login.tsx');
      return { Component: Login };
    },
    ErrorBoundary: ErrorFallback,
    loader: async ({ request }) => {
      try {
        await fetchWhoami();
        const url = new URL(request.url);
        return redirect(url.searchParams.get('redirect') || '/');
      } catch (_error) {
        return null;
      }
    }
  },
  {
    path: '/register',
    lazy: async () => {
      const { Register } = await import('@/pages/register/register.tsx');
      return { Component: Register };
    },
    ErrorBoundary: ErrorFallback,
    loader: async () => {
      try {
        await fetchWhoami();
        return redirect('/');
      } catch (_error) {
        return null;
      }
    }
  }
]);
