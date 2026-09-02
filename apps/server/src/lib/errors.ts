/**
 * Application errors carry an HTTP status and a stable machine-readable code.
 * Handlers throw these; the Fastify error handler is the single place that
 * turns them into a response, so no route builds an error body by hand.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Expected failures are logged at `warn`; unexpected ones at `error`. */
  readonly expected: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; expected?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expected = options.expected ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Malformed request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload exceeds the configured limit') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Dependency unavailable', cause?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, { cause, expected: false });
  }
}

/**
 * A failed SMTP transaction. `permanent` decides the retry policy: 5xx replies
 * and malformed addresses are terminal, 4xx replies and socket errors are not.
 * This distinction is the core of MTA behaviour — retrying a permanent failure
 * wastes attempts, and giving up on a transient one silently drops mail.
 */
export class SmtpDeliveryError extends AppError {
  readonly responseCode: number | null;
  readonly responseText: string | null;
  readonly permanent: boolean;

  constructor(
    message: string,
    options: {
      responseCode?: number | null;
      responseText?: string | null;
      permanent?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(502, 'SMTP_DELIVERY_FAILED', message, { cause: options.cause, expected: true });
    this.responseCode = options.responseCode ?? null;
    this.responseText = options.responseText ?? null;
    this.permanent = options.permanent ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
