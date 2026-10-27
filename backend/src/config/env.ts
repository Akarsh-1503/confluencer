import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

function str(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, received "${raw}"`);
  }
  return parsed;
}

const nodeEnv = str('NODE_ENV', 'development');

/** Absolute path to the SQLite file. `:memory:` is passed through untouched for tests. */
function resolveDatabasePath(): string {
  const configured = str('DATABASE_PATH', './data/confluencr.sqlite');
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured) ? configured : path.join(BACKEND_ROOT, configured);
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int('PORT', 4000),
  databasePath: resolveDatabasePath(),
  jwtSecret: str('JWT_SECRET', 'dev-only-change-me-7f3c1a9b2d4e6f8a'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '12h'),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: int('RATE_LIMIT_MAX', 600),
  logFormat: str('LOG_FORMAT', 'dev'),
} as const;

if (env.isProduction && env.jwtSecret.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set to a strong secret when NODE_ENV=production');
}
