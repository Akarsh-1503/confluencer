import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { orgContext, requirePermission, resolveOrgContext } from '../../middleware/orgContext.js';
import { validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { toMajorUnits } from '../../utils/money.js';
import { orgIdParams } from '../common/schemas.js';
import { verifyLedgerIntegrity } from '../ledger/ledger.service.js';

const windowQuery = z.object({
  days: z
    .string()
    .trim()
    .regex(/^\d+$/, 'days must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1 && value <= 365, 'days must be between 1 and 365')
    .default('30'),
});

const limitQuery = z.object({
  limit: z
    .string()
    .trim()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1 && value <= 50, 'limit must be between 1 and 50')
    .default('8'),
});

/** `YYYY-MM-DD` for a day offset from today, in UTC — matches how created_at is stored. */
function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.use(
  authenticate,
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('analytics:read'),
);

/** Headline KPIs for the dashboard tiles. */
analyticsRouter.get(
  '/overview',
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const db = getDb();

    const accounts = db
      .prepare<[string], {
        account_count: number;
        active_count: number;
        frozen_count: number;
        closed_count: number;
        total_balance_minor: number;
        max_balance_minor: number;
      }>(
        `SELECT COUNT(*) AS account_count,
                COALESCE(SUM(status = 'active'), 0) AS active_count,
                COALESCE(SUM(status = 'frozen'), 0) AS frozen_count,
                COALESCE(SUM(status = 'closed'), 0) AS closed_count,
                COALESCE(SUM(balance_minor), 0)     AS total_balance_minor,
                COALESCE(MAX(balance_minor), 0)     AS max_balance_minor
           FROM accounts WHERE org_id = ?`,
      )
      .get(org.id);

    const totals = db
      .prepare<[string], {
        transaction_count: number;
        credit_count: number;
        debit_count: number;
        credit_minor: number;
        debit_minor: number;
        avg_minor: number;
        largest_minor: number;
      }>(
        `SELECT COUNT(*) AS transaction_count,
                COALESCE(SUM(type = 'credit'), 0) AS credit_count,
                COALESCE(SUM(type = 'debit'), 0)  AS debit_count,
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount_minor ELSE 0 END), 0) AS credit_minor,
                COALESCE(SUM(CASE WHEN type = 'debit'  THEN amount_minor ELSE 0 END), 0) AS debit_minor,
                COALESCE(CAST(AVG(amount_minor) AS INTEGER), 0) AS avg_minor,
                COALESCE(MAX(amount_minor), 0) AS largest_minor
           FROM transactions WHERE org_id = ?`,
      )
      .get(org.id);

    const since = `${dayKey(-6)}T00:00:00.000Z`;
    const recent = db
      .prepare<[string, string], {
        transaction_count: number;
        credit_minor: number;
        debit_minor: number;
      }>(
        `SELECT COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount_minor ELSE 0 END), 0) AS credit_minor,
                COALESCE(SUM(CASE WHEN type = 'debit'  THEN amount_minor ELSE 0 END), 0) AS debit_minor
           FROM transactions WHERE org_id = ? AND created_at >= ?`,
      )
      .get(org.id, since);

    const transferCount =
      db
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM transfers WHERE org_id = ?',
        )
        .get(org.id)?.count ?? 0;

    const memberCount =
      db
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM memberships WHERE org_id = ?',
        )
        .get(org.id)?.count ?? 0;

    const creditMinor = totals?.credit_minor ?? 0;
    const debitMinor = totals?.debit_minor ?? 0;
    const totalVolume = creditMinor + debitMinor;

    res.json({
      data: {
        currency: org.currency,
        accounts: {
          total: accounts?.account_count ?? 0,
          active: accounts?.active_count ?? 0,
          frozen: accounts?.frozen_count ?? 0,
          closed: accounts?.closed_count ?? 0,
        },
        balances: {
          total: toMajorUnits(accounts?.total_balance_minor ?? 0),
          largest_account_balance: toMajorUnits(accounts?.max_balance_minor ?? 0),
          average_per_account: toMajorUnits(
            accounts && accounts.account_count > 0
              ? Math.round(accounts.total_balance_minor / accounts.account_count)
              : 0,
          ),
        },
        transactions: {
          total: totals?.transaction_count ?? 0,
          credits: totals?.credit_count ?? 0,
          debits: totals?.debit_count ?? 0,
          total_credit: toMajorUnits(creditMinor),
          total_debit: toMajorUnits(debitMinor),
          net_flow: toMajorUnits(creditMinor - debitMinor),
          average_amount: toMajorUnits(totals?.avg_minor ?? 0),
          largest_amount: toMajorUnits(totals?.largest_minor ?? 0),
          credit_share:
            totalVolume === 0 ? 0 : Math.round((creditMinor / totalVolume) * 1000) / 10,
        },
        last_7_days: {
          transactions: recent?.transaction_count ?? 0,
          total_credit: toMajorUnits(recent?.credit_minor ?? 0),
          total_debit: toMajorUnits(recent?.debit_minor ?? 0),
          net_flow: toMajorUnits((recent?.credit_minor ?? 0) - (recent?.debit_minor ?? 0)),
        },
        transfers: { total: transferCount },
        members: { total: memberCount },
      },
    });
  }),
);

/** Daily credit / debit / net series with gaps filled, for the area chart. */
analyticsRouter.get(
  '/cashflow',
  validateQuery(windowQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { days } = req.query as unknown as { days: number };
    const db = getDb();
    const since = `${dayKey(-(days - 1))}T00:00:00.000Z`;

    const rows = db
      .prepare<[string, string], {
        day: string;
        credit_minor: number;
        debit_minor: number;
        transaction_count: number;
      }>(
        `SELECT substr(created_at, 1, 10) AS day,
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount_minor ELSE 0 END), 0) AS credit_minor,
                COALESCE(SUM(CASE WHEN type = 'debit'  THEN amount_minor ELSE 0 END), 0) AS debit_minor,
                COUNT(*) AS transaction_count
           FROM transactions
          WHERE org_id = ? AND created_at >= ?
          GROUP BY day
          ORDER BY day ASC`,
      )
      .all(org.id, since);

    const byDay = new Map(rows.map((row) => [row.day, row]));

    // Opening balance for the window = current total balance minus everything that
    // happened inside the window, so the cumulative line ends at today's real balance.
    const totalBalanceMinor =
      db
        .prepare<[string], { total: number }>(
          'SELECT COALESCE(SUM(balance_minor), 0) AS total FROM accounts WHERE org_id = ?',
        )
        .get(org.id)?.total ?? 0;
    const windowNetMinor = rows.reduce(
      (sum, row) => sum + row.credit_minor - row.debit_minor,
      0,
    );

    let running = totalBalanceMinor - windowNetMinor;
    const series = Array.from({ length: days }, (_, index) => {
      const day = dayKey(-(days - 1 - index));
      const row = byDay.get(day);
      const creditMinor = row?.credit_minor ?? 0;
      const debitMinor = row?.debit_minor ?? 0;
      running += creditMinor - debitMinor;
      return {
        date: day,
        credit: toMajorUnits(creditMinor),
        debit: toMajorUnits(debitMinor),
        net: toMajorUnits(creditMinor - debitMinor),
        cumulative_balance: toMajorUnits(running),
        transaction_count: row?.transaction_count ?? 0,
      };
    });

    res.json({ data: series, meta: { days, timezone: 'UTC' } });
  }),
);

/** Balance share per account — the pie / donut data set. */
analyticsRouter.get(
  '/balance-distribution',
  validateQuery(limitQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { limit } = req.query as unknown as { limit: number };
    const db = getDb();

    const rows = db
      .prepare<[string], {
        id: string;
        name: string;
        code: string;
        status: string;
        balance_minor: number;
      }>(
        `SELECT id, name, code, status, balance_minor
           FROM accounts
          WHERE org_id = ?
          ORDER BY balance_minor DESC, name COLLATE NOCASE ASC`,
      )
      .all(org.id);

    const totalMinor = rows.reduce((sum, row) => sum + row.balance_minor, 0);
    const head = rows.slice(0, limit);
    const tail = rows.slice(limit);

    const slices = head.map((row) => ({
      account_id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      balance: toMajorUnits(row.balance_minor),
      share: totalMinor === 0 ? 0 : Math.round((row.balance_minor / totalMinor) * 1000) / 10,
    }));

    if (tail.length > 0) {
      const tailMinor = tail.reduce((sum, row) => sum + row.balance_minor, 0);
      slices.push({
        account_id: '__other__',
        name: `Other (${tail.length} account${tail.length === 1 ? '' : 's'})`,
        code: '—',
        status: 'aggregate',
        balance: toMajorUnits(tailMinor),
        share: totalMinor === 0 ? 0 : Math.round((tailMinor / totalMinor) * 1000) / 10,
      });
    }

    res.json({
      data: slices,
      meta: { total_balance: toMajorUnits(totalMinor), account_count: rows.length },
    });
  }),
);

/** Credit vs debit split by count and by value — donut chart data. */
analyticsRouter.get(
  '/type-split',
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const db = getDb();
    const rows = db
      .prepare<[string], { type: string; count: number; amount_minor: number }>(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS amount_minor
           FROM transactions WHERE org_id = ? GROUP BY type`,
      )
      .all(org.id);

    const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
    const totalMinor = rows.reduce((sum, row) => sum + row.amount_minor, 0);

    res.json({
      data: ['credit', 'debit'].map((type) => {
        const row = rows.find((candidate) => candidate.type === type);
        return {
          type,
          count: row?.count ?? 0,
          amount: toMajorUnits(row?.amount_minor ?? 0),
          count_share: totalCount === 0 ? 0 : Math.round(((row?.count ?? 0) / totalCount) * 1000) / 10,
          amount_share:
            totalMinor === 0 ? 0 : Math.round(((row?.amount_minor ?? 0) / totalMinor) * 1000) / 10,
        };
      }),
      meta: { total_count: totalCount, total_amount: toMajorUnits(totalMinor) },
    });
  }),
);

/**
 * Per-account metrics plotted as bubbles: x = activity, y = balance, size = throughput.
 * One glance shows which accounts are big, which are busy, and which are both.
 */
analyticsRouter.get(
  '/account-matrix',
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const db = getDb();

    const rows = db
      .prepare<[string], {
        id: string;
        name: string;
        code: string;
        status: string;
        balance_minor: number;
        transaction_count: number;
        credit_minor: number;
        debit_minor: number;
        last_activity_at: string | null;
      }>(
        `SELECT a.id, a.name, a.code, a.status, a.balance_minor,
                COUNT(t.id) AS transaction_count,
                COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_minor ELSE 0 END), 0) AS credit_minor,
                COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN t.amount_minor ELSE 0 END), 0) AS debit_minor,
                MAX(t.created_at) AS last_activity_at
           FROM accounts a
           LEFT JOIN transactions t ON t.account_id = a.id
          WHERE a.org_id = ?
          GROUP BY a.id
          ORDER BY a.balance_minor DESC`,
      )
      .all(org.id);

    res.json({
      data: rows.map((row) => ({
        account_id: row.id,
        name: row.name,
        code: row.code,
        status: row.status,
        balance: toMajorUnits(row.balance_minor),
        transaction_count: row.transaction_count,
        total_credit: toMajorUnits(row.credit_minor),
        total_debit: toMajorUnits(row.debit_minor),
        throughput: toMajorUnits(row.credit_minor + row.debit_minor),
        last_activity_at: row.last_activity_at,
      })),
    });
  }),
);

/** Transaction counts bucketed by weekday and hour (UTC) — heatmap data. */
analyticsRouter.get(
  '/activity-heatmap',
  validateQuery(windowQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { days } = req.query as unknown as { days: number };
    const db = getDb();
    const since = `${dayKey(-(days - 1))}T00:00:00.000Z`;

    const rows = db
      .prepare<[string, string], { weekday: string; hour: string; count: number; amount_minor: number }>(
        `SELECT CAST(strftime('%w', created_at) AS TEXT) AS weekday,
                CAST(strftime('%H', created_at) AS TEXT) AS hour,
                COUNT(*) AS count,
                COALESCE(SUM(amount_minor), 0) AS amount_minor
           FROM transactions
          WHERE org_id = ? AND created_at >= ?
          GROUP BY weekday, hour`,
      )
      .all(org.id, since);

    res.json({
      data: rows.map((row) => ({
        weekday: Number.parseInt(row.weekday, 10),
        hour: Number.parseInt(row.hour, 10),
        count: row.count,
        amount: toMajorUnits(row.amount_minor),
      })),
      meta: { days, timezone: 'UTC' },
    });
  }),
);

/** Busiest accounts by number of entries, for the ranked bar chart. */
analyticsRouter.get(
  '/top-accounts',
  validateQuery(limitQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { limit } = req.query as unknown as { limit: number };
    const db = getDb();

    const rows = db
      .prepare<[string, number], {
        id: string;
        name: string;
        code: string;
        transaction_count: number;
        credit_minor: number;
        debit_minor: number;
        balance_minor: number;
      }>(
        `SELECT a.id, a.name, a.code, a.balance_minor,
                COUNT(t.id) AS transaction_count,
                COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_minor ELSE 0 END), 0) AS credit_minor,
                COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN t.amount_minor ELSE 0 END), 0) AS debit_minor
           FROM accounts a
           LEFT JOIN transactions t ON t.account_id = a.id
          WHERE a.org_id = ?
          GROUP BY a.id
          ORDER BY transaction_count DESC, a.balance_minor DESC
          LIMIT ?`,
      )
      .all(org.id, limit);

    res.json({
      data: rows.map((row) => ({
        account_id: row.id,
        name: row.name,
        code: row.code,
        transaction_count: row.transaction_count,
        total_credit: toMajorUnits(row.credit_minor),
        total_debit: toMajorUnits(row.debit_minor),
        balance: toMajorUnits(row.balance_minor),
      })),
    });
  }),
);

/* ------------------------------------------------------------------ *
 * /organizations/:orgId/ledger
 * ------------------------------------------------------------------ */
export const ledgerRouter = Router({ mergeParams: true });

ledgerRouter.use(authenticate, validateParams(orgIdParams), resolveOrgContext);

/**
 * Re-derives every balance from the transaction log and reports any drift. The UI shows
 * this as a live "ledger integrity" indicator; the test suite asserts `consistent: true`
 * after mixed credit/debit/transfer workloads.
 */
ledgerRouter.get(
  '/integrity',
  requirePermission('analytics:read'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const report = verifyLedgerIntegrity(org.id);
    res.status(report.consistent ? 200 : 500).json({ data: report });
  }),
);
