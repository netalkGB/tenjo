import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { ErrorBoundary } from 'react-error-boundary';
import './index.css';
import { i18n } from './i18n/config';
import { I18nProvider } from '@lingui/react';
import { RouterProvider } from 'react-router';
import { ErrorFallback } from './components/error';
import { DialogProvider } from './contexts/dialog-context';
import { CustomDialog } from '@/components/common/custom-dialog';
import { useDialog } from '@/hooks/useDialog';

import { routes } from './router';

// Apply OS theme preference on startup (before DB preferences are loaded)
const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
document.documentElement.classList.toggle('dark', darkModeQuery.matches);

// Axios interceptor for CSRF token
axios.interceptors.request.use(config => {
  const csrfToken = document.body.dataset.csrfToken;
  if (csrfToken) {
    config.headers['x-csrf-token'] = csrfToken;
  }
  return config;
});

// Axios interceptor for 401 Unauthorized - reload the current page
// A reload fetches a fresh session + CSRF token; the router loader
// will redirect to /login if the user is no longer authenticated.
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      const path = window.location.pathname;
      const url = error.config?.url ?? '';
      const isAuthPage = path === '/login' || path === '/register';
      const isAuthApi =
        url === '/api/login' ||
        url === '/api/register' ||
        url.startsWith('/api/register/');
      if (!isAuthPage && !isAuthApi) {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    return Promise.reject(error);
  }
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <I18nProvider i18n={i18n}>
        <DialogProvider>
          <Suspense fallback={null}>
            <RouterProvider router={routes} />
          </Suspense>
          <DialogStack />
        </DialogProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>
);

// eslint-disable-next-line react-refresh/only-export-components
function DialogStack() {
  const { dialogs, closeDialog } = useDialog();
  const lastIndex = dialogs.length - 1;

  return (
    <>
      {dialogs.map((dialog, index) => {
        const isTopMost = index === lastIndex;
        return (
          <div
            key={dialog.id}
            style={{
              zIndex: 50 + index
            }}
          >
            <CustomDialog
              isOpen={true}
              modal={isTopMost}
              showCloseButton={dialog.showCloseButton}
              closeOnOutsideClick={dialog.closeOnOutsideClick}
              title={dialog.title}
              content={dialog.content}
              description={dialog.description}
              type={dialog.type}
              okText={dialog.okText}
              cancelText={dialog.cancelText}
              customFooter={dialog.customFooter}
              onOpenChange={() => closeDialog(dialog.id)}
              onOk={dialog.onOk}
              onCancel={dialog.onCancel}
            />
          </div>
        );
      })}
    </>
  );
}
