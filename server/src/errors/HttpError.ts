import { getReasonPhrase } from 'http-status-codes';

/**
 * Base HTTP error class.
 * Throw directly from route handlers, or extend in domain-specific error classes.
 * The global error handler catches it and produces an RFC 9457 response.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly title: string;
  public readonly errors?: string[];

  constructor(statusCode: number, detail: string, errors?: string[]) {
    super(detail);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.title = getReasonPhrase(statusCode);
    this.errors = errors;
  }
}
