import type { NextFunction, Request, Response } from 'express';
import { newRequestId } from '../utils/id.js';

/** Stamps every request with a correlation id and echoes it back on the response. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 100 ? incoming : newRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
