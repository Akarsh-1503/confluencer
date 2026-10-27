import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { findUserById } from '../modules/auth/users.repository.js';

/** Requires a valid `Authorization: Bearer <jwt>` whose subject still exists. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    next(
      AppError.unauthorized(
        'UNAUTHENTICATED',
        'Missing bearer token. Send "Authorization: Bearer <token>".',
      ),
    );
    return;
  }

  const token = header.slice(7).trim();
  if (!token) {
    next(AppError.unauthorized('UNAUTHENTICATED', 'Bearer token is empty'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = findUserById(payload.sub);
    if (!user) {
      next(AppError.unauthorized('USER_NOT_FOUND', 'The account for this token no longer exists'));
      return;
    }
    req.auth = { userId: user.id, email: user.email, name: user.name };
    next();
  } catch (error) {
    next(error);
  }
}

export function currentUser(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}
