import { createBrowserRouter } from 'react-router';
import { ErrorFallback } from '../components/error/index.ts'; // Adjust path as needed
import { Login } from '@/pages/login/login.tsx';
import { Register } from '@/pages/register/register.tsx';
import { redirect } from 'react-router';
import { fetchWhoami } from '@/api/server/whoami';
import { getThreadMessages, getThreads } from '@/api/server/chat';
import { Main } from '@/layouts/main';
import { Home } from '@/pages/main/home';
import { History } from '@/pages/main/history';
import { Chat } from '@/pages/main/chat/';
import { Settings } from '@/pages/main/settings';

export const routes = createBrowserRouter([
  {
    path: '/',
    Component: Main,
    ErrorBoundary: ErrorFallback,
    loader: async () => {
      try {
        return await fetchWhoami();
      } catch (_error) {
        return redirect('/login');
      }
    },
    children: [
      {
        index: true,
        Component: Home
      },
      {
        path: '/history',
        Component: History,
        loader: ({ request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get('page')) || 1;
          const searchWord = url.searchParams.get('q') || undefined;
          const pageSize = 15;

          const dataPromise = getThreads({
            pageSize,
            pageNumber: page,
            searchWord
          });

          return { data: dataPromise, searchWord, pageSize };
        }
      },
      {
        path: '/settings',
        Component: Settings
      },
      {
        path: '/chat',
        children: [
          {
            path: ':id',
            Component: Chat,
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
    Component: Login,
    ErrorBoundary: ErrorFallback,
    loader: async () => {
      try {
        await fetchWhoami();
        return redirect('/');
      } catch (_error) {
        return null; // Allow access to login page
      }
    }
  },
  {
    path: '/register',
    Component: Register,
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
