import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { analyticsRouter, ledgerRouter } from './modules/analytics/analytics.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import {
  accountTransactionsRouter,
  transactionsRouter,
} from './modules/transactions/transactions.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';

const API_PREFIX = '/api/v1';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Server-to-server callers (curl, tests) send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: false,
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(requestContext);
  if (env.logFormat !== 'off' && !env.isTest) {
    app.use(morgan(env.logFormat));
  }
  app.use(rateLimit());

  app.get(`${API_PREFIX}/health`, (_req, res) => {
    const db = getDb();
    const check = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    res.json({
      data: {
        status: check?.ok === 1 ? 'ok' : 'degraded',
        service: 'confluencr-ledger-api',
        version: '1.0.0',
        environment: env.nodeEnv,
        database: 'sqlite',
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });

  /** Tiny self-describing index so a reviewer can explore without the docs open. */
  app.get(API_PREFIX, (_req, res) => {
    res.json({
      data: {
        service: 'Confluencr Ledger API',
        version: 'v1',
        documentation: 'docs/API.md',
        endpoints: {
          auth: [
            'POST   /api/v1/auth/register',
            'POST   /api/v1/auth/login',
            'GET    /api/v1/auth/me',
            'GET    /api/v1/auth/roles',
          ],
          organizations: [
            'GET    /api/v1/organizations',
            'POST   /api/v1/organizations',
            'GET    /api/v1/organizations/:orgId',
            'PATCH  /api/v1/organizations/:orgId',
            'GET    /api/v1/organizations/:orgId/members',
            'POST   /api/v1/organizations/:orgId/members',
            'PATCH  /api/v1/organizations/:orgId/members/:userId',
            'DELETE /api/v1/organizations/:orgId/members/:userId',
            'GET    /api/v1/organizations/:orgId/audit-logs',
          ],
          accounts: [
            'GET    /api/v1/organizations/:orgId/accounts',
            'POST   /api/v1/organizations/:orgId/accounts',
            'GET    /api/v1/organizations/:orgId/accounts/:accountId',
            'PATCH  /api/v1/organizations/:orgId/accounts/:accountId',
          ],
          transactions: [
            'GET    /api/v1/organizations/:orgId/transactions',
            'POST   /api/v1/organizations/:orgId/transactions',
            'GET    /api/v1/organizations/:orgId/transactions/export',
            'GET    /api/v1/organizations/:orgId/transactions/:transactionId',
            'GET    /api/v1/organizations/:orgId/accounts/:accountId/transactions',
            'POST   /api/v1/organizations/:orgId/accounts/:accountId/transactions',
          ],
          transfers: [
            'GET    /api/v1/organizations/:orgId/transfers',
            'POST   /api/v1/organizations/:orgId/transfers',
            'GET    /api/v1/organizations/:orgId/transfers/:transferId',
          ],
          analytics: [
            'GET    /api/v1/organizations/:orgId/analytics/overview',
            'GET    /api/v1/organizations/:orgId/analytics/cashflow',
            'GET    /api/v1/organizations/:orgId/analytics/balance-distribution',
            'GET    /api/v1/organizations/:orgId/analytics/type-split',
            'GET    /api/v1/organizations/:orgId/analytics/account-matrix',
            'GET    /api/v1/organizations/:orgId/analytics/activity-heatmap',
            'GET    /api/v1/organizations/:orgId/analytics/top-accounts',
            'GET    /api/v1/organizations/:orgId/ledger/integrity',
          ],
        },
      },
    });
  });

  // Nested resources are registered before the organizations router so the more specific
  // prefixes win regardless of Express's prefix matching.
  app.use(`${API_PREFIX}/organizations/:orgId/accounts/:accountId/transactions`, accountTransactionsRouter);
  app.use(`${API_PREFIX}/organizations/:orgId/accounts`, accountsRouter);
  app.use(`${API_PREFIX}/organizations/:orgId/transactions`, transactionsRouter);
  app.use(`${API_PREFIX}/organizations/:orgId/transfers`, transfersRouter);
  app.use(`${API_PREFIX}/organizations/:orgId/analytics`, analyticsRouter);
  app.use(`${API_PREFIX}/organizations/:orgId/ledger`, ledgerRouter);
  app.use(`${API_PREFIX}/organizations`, organizationsRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
