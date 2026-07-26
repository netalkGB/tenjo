import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ApiError } from '@/api/errors/ApiError';

interface ErrorPresentation {
  title: string;
  description: string;
}

function statusFromError(error: unknown): number | null {
  if (isRouteErrorResponse(error)) {
    return error.status;
  }
  if (error instanceof ApiError) {
    return error.code;
  }
  if (error instanceof Response) {
    return error.status;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'number'
  ) {
    return (error as { code: number }).code;
  }
  return null;
}

function messageFromError(error: unknown): string | null {
  if (isRouteErrorResponse(error)) {
    const data = error.data;
    if (typeof data === 'string' && data.trim()) {
      return data;
    }
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
    ) {
      return (data as { message: string }).message;
    }
    return error.statusText || null;
  }
  if (
    error instanceof Error &&
    error.message &&
    error.message !== 'API Error'
  ) {
    return error.message;
  }
  return null;
}

function presentationForError(error: unknown): ErrorPresentation {
  const status = statusFromError(error);
  const detail = messageFromError(error);

  switch (status) {
    case 400:
      return {
        title: 'Bad Request',
        description: detail ?? 'The request could not be understood.'
      };
    case 401:
      return {
        title: 'Unauthorized',
        description: detail ?? 'You need to sign in to view this page.'
      };
    case 403:
      return {
        title: 'Forbidden',
        description: detail ?? 'You do not have permission to view this page.'
      };
    case 404:
      return {
        title: 'Not Found',
        description:
          detail && detail !== 'Not Found' && detail !== 'API Error'
            ? detail
            : 'The page you are looking for does not exist.'
      };
    case 409:
      return {
        title: 'Conflict',
        description: detail ?? 'The request conflicts with the current state.'
      };
    case 503:
      return {
        title: 'Service Unavailable',
        description:
          detail ?? 'The service is temporarily unavailable. Please try again.'
      };
    default:
      if (status !== null && status >= 500) {
        return {
          title: 'Server Error',
          description: detail ?? 'An unexpected server error occurred.'
        };
      }
      return {
        title: 'Something went wrong',
        description: detail ?? 'An unexpected error occurred'
      };
  }
}

function ErrorView({ error }: { error?: unknown }) {
  const { title, description } = presentationForError(error);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-red-600">{title}</h1>
        <p className="text-gray-600">{description}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

/**
 * Used as:
 * - react-error-boundary FallbackComponent ({ error })
 * - React Router route ErrorBoundary (useRouteError)
 * - Direct render: <ErrorFallback error={...} />
 */
export function ErrorFallback({ error }: { error?: unknown } = {}) {
  if (error !== undefined) {
    return <ErrorView error={error} />;
  }
  return <RouteErrorFallback />;
}

function RouteErrorFallback() {
  const error = useRouteError();
  return <ErrorView error={error} />;
}
