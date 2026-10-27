import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

type Bucket = { count: number; resetAt: number };

/**
 * Small fixed-window limiter. In-process on purpose: this app runs as a single node for
 * the assessment, and a Redis-backed limiter would be the drop-in replacement for a
 * multi-instance deployment.
 */
export function rateLimit(options?: { windowMs?: number; max?: number }): RequestHandler {
  const windowMs = options?.windowMs ?? env.rateLimitWindowMs;
  const max = options?.max ?? env.rateLimitMax;
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    if (env.isTest) {
      next();
      return;
    }

    const key = `${req.ip ?? 'unknown'}:${req.path.startsWith('/api/v1/auth') ? 'auth' : 'api'}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > max) {
        res.setHeader('retry-after', Math.ceil((bucket.resetAt - now) / 1000));
        next(AppError.tooManyRequests());
        return;
      }
    }

    // Opportunistic cleanup keeps the map from growing without bound.
    if (buckets.size > 5_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    next();
  };
}
