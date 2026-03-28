import { createBrowserRouter, redirect } from 'react-router';
import { ErrorFallback } from '@/components/error';
import { fetchWhoami } from '@/api/server/whoami';
import { getThreadMessages } from '@/api/server/chat';

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
                throw new Error('Thread ID is required');
              }

              // Return the Promise as-is (do not await).
              const dataPromise = getThreadMessages(params.id);
              return {
                threadId: params.id,
                data: dataPromise
              };
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
