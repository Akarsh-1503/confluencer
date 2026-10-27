import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

type SqliteError = Error & { code?: string; message: string };

/**
 * Translates database-level integrity failures into the same error vocabulary the
 * service layer uses. The service checks these rules first for a friendly message; this
 * is the backstop that keeps a constraint violation from becoming a bare 500.
 */
function fromSqliteError(error: SqliteError): AppError | null {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (message.includes('TRANSACTION_IMMUTABLE')) {
    return AppError.methodNotAllowed(
      'TRANSACTION_IMMUTABLE',
      'Transactions are immutable and cannot be updated or deleted',
    );
  }
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    if (message.includes('transactions.account_id') || message.includes('transactions.reference_id')) {
      return AppError.conflict(
        'DUPLICATE_REFERENCE_ID',
        'A transaction with this reference_id already exists for this account',
      );
    }
    if (message.includes('transfers.reference_id')) {
      return AppError.conflict(
        'DUPLICATE_REFERENCE_ID',
        'A transfer with this reference_id already exists in this organization',
      );
    }
    if (message.includes('users.email_lower')) {
      return AppError.conflict('EMAIL_ALREADY_REGISTERED', 'This email is already registered');
    }
    if (message.includes('accounts.name')) {
      return AppError.conflict(
        'ACCOUNT_NAME_TAKEN',
        'An account with this name already exists in this organization',
      );
    }
    if (message.includes('memberships.org_id')) {
      return AppError.conflict('ALREADY_A_MEMBER', 'This user is already a member of the organization');
    }
    return AppError.conflict('UNIQUE_CONSTRAINT_VIOLATION', 'A record with these values already exists');
  }
  if (code === 'SQLITE_CONSTRAINT_CHECK') {
    if (message.includes('balance_minor')) {
      return AppError.unprocessable(
        'INSUFFICIENT_BALANCE',
        'The account does not have sufficient balance for this debit',
      );
    }
    return AppError.badRequest('CONSTRAINT_VIOLATION', 'The request violates a data integrity rule');
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return AppError.badRequest(
      'FOREIGN_KEY_VIOLATION',
      'A referenced record does not exist',
    );
  }
  if (code === 'SQLITE_BUSY') {
    return new AppError(
      503,
      'LEDGER_BUSY',
      'The ledger is processing another write for this account, please retry',
    );
  }
  return null;
}

function isBodyParserError(error: unknown): error is Error & { status?: number; type?: string } {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    'body' in (error as Record<string, unknown>)
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (isBodyParserError(error)) {
    appError = AppError.badRequest('MALFORMED_JSON', 'Request body is not valid JSON');
  } else if (error instanceof Error) {
    appError = fromSqliteError(error as SqliteError) ?? AppError.internal();
  } else {
    appError = AppError.internal();
  }

  if (appError.status >= 500 && !env.isTest) {
    console.error(`[${req.requestId}] ${req.method} ${req.originalUrl} ->`, error);
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
    request_id: req.requestId,
    ...(appError.status >= 500 && !env.isProduction && error instanceof Error
      ? { debug: { name: error.name, message: error.message } }
      : {}),
  });
};

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    AppError.notFound('ROUTE_NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}`),
  );
}
