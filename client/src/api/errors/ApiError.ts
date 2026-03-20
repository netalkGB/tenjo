/**
 * API Error Exception Class
 * Used for handling errors from API calls
 */
export class ApiError extends Error {
  public readonly code: number | null;

  constructor(message: string | null, code: number | null) {
    super(message || 'API Error');
    this.name = 'ApiError';
    this.code = code;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}
