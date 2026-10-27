export type ErrorDetail = {
  field?: string;
  message: string;
  [key: string]: unknown;
};

/**
 * Every failure the API returns on purpose is an AppError. The global error handler
 * turns it into the single error envelope documented in docs/API.md; anything that is
 * not an AppError is treated as an unexpected 500 and logged.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details && details.length > 0) this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(400, code, message, details);
  }

  static validation(message = 'The request payload failed validation', details?: ErrorDetail[]) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(code = 'UNAUTHENTICATED', message = 'Authentication is required') {
    return new AppError(401, code, message);
  }

  static forbidden(code = 'FORBIDDEN', message = 'You do not have permission to perform this action', details?: ErrorDetail[]) {
    return new AppError(403, code, message, details);
  }

  static notFound(code: string, message: string) {
    return new AppError(404, code, message);
  }

  static methodNotAllowed(code: string, message: string) {
    return new AppError(405, code, message);
  }

  static conflict(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(409, code, message, details);
  }

  /** Request was well formed but violates a business rule (e.g. insufficient balance). */
  static unprocessable(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(422, code, message, details);
  }

  static tooManyRequests(message = 'Too many requests, please retry later') {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'An unexpected error occurred') {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
