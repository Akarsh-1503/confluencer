import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError, type ErrorDetail } from '../errors/AppError.js';

type Source = 'body' | 'query' | 'params';

function toDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validates and replaces one part of the request with the parsed (and coerced) value,
 * so handlers only ever see data that already matched the schema.
 */
export function validate(source: Source, schema: ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message =
        source === 'query'
          ? 'One or more query parameters are invalid'
          : source === 'params'
            ? 'One or more path parameters are invalid'
            : 'The request body failed validation';
      next(AppError.validation(message, toDetails(result.error)));
      return;
    }
    // `req.query`/`req.params` are getters in Express 4 but writable objects in practice;
    // assigning through a cast keeps the parsed output without fighting the types.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}

export const validateBody = (schema: ZodTypeAny) => validate('body', schema);
export const validateQuery = (schema: ZodTypeAny) => validate('query', schema);
export const validateParams = (schema: ZodTypeAny) => validate('params', schema);
