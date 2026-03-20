/**
 * Client Side Validation Error Exception Class
 * Used for handling validation errors on the client side
 */
export class ClientSideValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientSideValidationError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ClientSideValidationError);
    }
  }
}
