/**
 * Common API Types
 * Shared types used across all API endpoints
 */

import type { Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

/**
 * Session user object stored in express-session.
 * - id: users.id (UUID primary key)
 * - userName: users.user_name (login handle)
 */
export type UserRole = 'admin' | 'standard';

export interface SessionUser {
  id: string;
  userName: string;
  userRole: UserRole;
}

/**
 * RFC 9457 Problem Details for HTTP APIs
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
export interface ErrorResponse {
  /**
   * A URI reference that identifies the problem type
   */
  type?: string;

  /**
   * A short, human-readable summary of the problem type
   */
  title?: string;

  /**
   * The HTTP status code
   */
  status?: number;

  /**
   * A human-readable explanation specific to this occurrence of the problem
   */
  detail?: string;

  /**
   * A URI reference that identifies the specific occurrence of the problem
   */
  instance?: string;

  /**
   * Additional members for extending the problem details
   */
  [key: string]: unknown;
}

/**
 * Per-endpoint request definition.
 * Each endpoint should define a single interface with optional params, body, and query.
 */
export interface RequestDef {
  params?: Record<string, string | string[]>;
  body?: unknown;
  query?: Record<string, string>;
}

/**
 * Maps a RequestDef to a properly typed Express Request.
 */
export type TypedRequest<T extends RequestDef = RequestDef> = Request<
  (T extends { params: infer P } ? P : object) & ParamsDictionary,
  unknown,
  T extends { body: infer B } ? B : unknown,
  T extends { query: infer Q } ? Q : ParsedQs
>;

/**
 * Creates a type-safe Express request handler.
 * Bridges typed request definitions with Express's middleware chain.
 */
export function typedHandler<T extends RequestDef = RequestDef, TRes = unknown>(
  handler: (req: TypedRequest<T>, res: Response<TRes>) => Promise<void> | void
): RequestHandler {
  return handler as unknown as RequestHandler;
}
