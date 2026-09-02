import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { isProduction } from '../config/env.js';
import { AppError, isAppError } from '../lib/errors.js';

/**
 * The single place an error becomes a response.
 *
 * Every handler throws; nothing builds an error body inline. That keeps the
 * response shape uniform (matching `apiErrorSchema` in the shared package) and
 * means the decision about what to disclose to a client is made once, here,
 * rather than being re-litigated at every call site.
 */
export const errorHandlerPlugin = fp(async function errorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} does not exist` },
      requestId: request.id,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // Body, query or params that failed their Zod schema. The type provider
    // wraps the ZodError in a Fastify validation error, so the issues are read
    // through its helper rather than by an `instanceof ZodError` check — which
    // never matches once the request has passed through the compiler.
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.warn({ issues: error.validation }, 'Request failed validation');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request failed validation',
          // Echoing the per-field issues is safe — the client sent the data —
          // and saves a round of guessing at which field was wrong.
          details: error.validation.map((issue) => ({
            path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.') || issue.params.issue.path.join('.'),
            message: issue.params.issue.message,
          })),
        },
        requestId: request.id,
      });
    }

    // A response that does not match its declared schema is our bug, not the
    // client's. It must never leak the malformed payload back out.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { issues: error.cause.issues, method: error.method, url: error.url },
        'Response failed its own schema',
      );
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Response failed validation' },
        requestId: request.id,
      });
    }

    // A raw ZodError from a service that validated something by hand.
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, 'Validation failed');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request failed validation',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        requestId: request.id,
      });
    }

    if (isAppError(error)) {
      const log = error.expected ? request.log.warn.bind(request.log) : request.log.error.bind(request.log);
      log({ err: error, code: error.code }, error.message);

      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
      });
    }

    // Fastify's own errors (rate limit, body too large, malformed JSON) already
    // carry a sensible status; anything without one is a bug on our side.
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;
    const message = fastifyError.message ?? 'Unknown error';

    if (statusCode < 500) {
      request.log.warn({ err: error }, message);
      return reply.status(statusCode).send({
        error: { code: fastifyError.code ?? 'BAD_REQUEST', message },
        requestId: request.id,
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        // Internal messages can name tables, hosts and file paths. In production
        // the client gets the request id and the detail stays in the logs.
        message: isProduction ? 'An unexpected error occurred' : message,
      },
      requestId: request.id,
    });
  });
});

export { AppError };
