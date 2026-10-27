import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';

export type TokenPayload = {
  sub: string;
  email: string;
  name: string;
};

export function signAccessToken(payload: TokenPayload): { token: string; expiresIn: string } {
  const token = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'confluencr-ledger',
  });
  return { token, expiresIn: env.jwtExpiresIn };
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: 'confluencr-ledger' });
    if (typeof decoded === 'string' || !decoded.sub) {
      throw AppError.unauthorized('INVALID_TOKEN', 'Access token payload is malformed');
    }
    return {
      sub: String(decoded.sub),
      email: String((decoded as jwt.JwtPayload).email ?? ''),
      name: String((decoded as jwt.JwtPayload).name ?? ''),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('TOKEN_EXPIRED', 'Access token has expired, please sign in again');
    }
    throw AppError.unauthorized('INVALID_TOKEN', 'Access token is invalid');
  }
}
