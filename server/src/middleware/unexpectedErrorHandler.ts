import type { ErrorRequestHandler } from 'express';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { HttpError } from '../errors/HttpError';
import logger from '../logger';

export const unexpectedErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    const response: Record<string, unknown> = {
      status: err.statusCode,
      title: err.title,
      detail: err.message
    };

    if (err.errors) {
      response.errors = err.errors;
    }

    res.status(err.statusCode).type('application/problem+json').json(response);
    return;
  }

  // Fallback for unexpected errors
  logger.error('Unhandled error:', err);
  res
    .status(StatusCodes.INTERNAL_SERVER_ERROR)
    .type('application/problem+json')
    .json({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      title: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR),
      detail: 'An unexpected error occurred'
    });
};
