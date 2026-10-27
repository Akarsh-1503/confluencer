import type { Db } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import type { TransactionRow, TransactionType } from '../../db/types.js';
import { newTransactionId } from '../../utils/id.js';
import { toMajorUnits } from '../../utils/money.js';

export function insertTransaction(
  input: {
    orgId: string;
    accountId: string;
    type: TransactionType;
    amountMinor: number;
    balanceAfterMinor: number;
    description?: string | null;
    referenceId: string;
    transferId?: string | null;
    counterpartyAccountId?: string | null;
    createdBy: string;
  },
  db: Db,
): TransactionRow {
  const row: TransactionRow = {
    id: newTransactionId(),
    org_id: input.orgId,
    account_id: input.accountId,
    type: input.type,
    amount_minor: input.amountMinor,
    balance_after_minor: input.balanceAfterMinor,
    description: input.description?.trim() || null,
    reference_id: input.referenceId.trim(),
    transfer_id: input.transferId ?? null,
    counterparty_account_id: input.counterpartyAccountId ?? null,
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO transactions
       (id, org_id, account_id, type, amount_minor, balance_after_minor, description,
        reference_id, transfer_id, counterparty_account_id, created_by, created_at)
     VALUES (@id, @org_id, @account_id, @type, @amount_minor, @balance_after_minor, @description,
        @reference_id, @transfer_id, @counterparty_account_id, @created_by, @created_at)`,
  ).run(row);
  return row;
}

export function findTransactionByReference(
  accountId: string,
  referenceId: string,
  db: Db = getDb(),
): TransactionRow | undefined {
  return db
    .prepare<[string, string], TransactionRow>(
      'SELECT * FROM transactions WHERE account_id = ? AND reference_id = ?',
    )
    .get(accountId, referenceId.trim());
}

export function findTransaction(
  orgId: string,
  transactionId: string,
  db: Db = getDb(),
): TransactionRow | undefined {
  return db
    .prepare<[string, string], TransactionRow>(
      'SELECT * FROM transactions WHERE org_id = ? AND id = ?',
    )
    .get(orgId, transactionId);
}

export type TransactionListFilters = {
  orgId: string;
  accountId?: string;
  type?: TransactionType;
  referenceId?: string;
  search?: string;
  from?: string;
  to?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  transfersOnly?: boolean;
  sort: 'created_at' | 'amount';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
};

const TRANSACTION_SORT_COLUMNS: Record<TransactionListFilters['sort'], string> = {
  created_at: 't.created_at',
  amount: 't.amount_minor',
};

export type TransactionListRow = TransactionRow & {
  account_name: string;
  account_code: string;
  created_by_name: string | null;
  counterparty_account_name: string | null;
};

function buildWhere(filters: TransactionListFilters): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = ['t.org_id = @orgId'];
  const params: Record<string, unknown> = { orgId: filters.orgId };

  if (filters.accountId) {
    where.push('t.account_id = @accountId');
    params.accountId = filters.accountId;
  }
  if (filters.type) {
    where.push('t.type = @type');
    params.type = filters.type;
  }
  if (filters.referenceId) {
    where.push('t.reference_id = @referenceId');
    params.referenceId = filters.referenceId;
  }
  if (filters.search) {
    where.push(
      '(t.description LIKE @search COLLATE NOCASE OR t.reference_id LIKE @search COLLATE NOCASE)',
    );
    params.search = `%${filters.search}%`;
  }
  if (filters.from) {
    where.push('t.created_at >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    where.push('t.created_at <= @to');
    params.to = filters.to;
  }
  if (filters.minAmountMinor !== undefined) {
    where.push('t.amount_minor >= @minAmount');
    params.minAmount = filters.minAmountMinor;
  }
  if (filters.maxAmountMinor !== undefined) {
    where.push('t.amount_minor <= @maxAmount');
    params.maxAmount = filters.maxAmountMinor;
  }
  if (filters.transfersOnly) {
    where.push('t.transfer_id IS NOT NULL');
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/**
 * Paginated ledger read. Default ordering is latest-first on `created_at`, with the
 * monotonic id as the tie-breaker so rows created in the same millisecond keep a stable,
 * correct order across pages.
 */
export function listTransactions(
  filters: TransactionListFilters,
  db: Db = getDb(),
): { rows: TransactionListRow[]; total: number } {
  const { whereSql, params } = buildWhere(filters);
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const orderSql = `ORDER BY ${TRANSACTION_SORT_COLUMNS[filters.sort]} ${direction}, t.id ${direction}`;

  const total =
    db
      .prepare<Record<string, unknown>, { count: number }>(
        `SELECT COUNT(*) AS count FROM transactions t ${whereSql}`,
      )
      .get(params)?.count ?? 0;

  const rows = db
    .prepare<Record<string, unknown>, TransactionListRow>(
      `SELECT t.*,
              a.name AS account_name,
              a.code AS account_code,
              u.name AS created_by_name,
              ca.name AS counterparty_account_name
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN users u ON u.id = t.created_by
         LEFT JOIN accounts ca ON ca.id = t.counterparty_account_id
         ${whereSql}
         ${orderSql}
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filters.limit, offset: filters.offset });

  return { rows, total };
}

/** Totals for the current filter set, so the UI can show "filtered" sums. */
export function aggregateTransactions(filters: TransactionListFilters, db: Db = getDb()) {
  const { whereSql, params } = buildWhere(filters);
  const row = db
    .prepare<Record<string, unknown>, {
      credit_count: number;
      debit_count: number;
      credit_minor: number;
      debit_minor: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN t.type = 'credit' THEN 1 ELSE 0 END), 0)            AS credit_count,
         COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN 1 ELSE 0 END), 0)            AS debit_count,
         COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_minor ELSE 0 END), 0) AS credit_minor,
         COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN t.amount_minor ELSE 0 END), 0) AS debit_minor
       FROM transactions t ${whereSql}`,
    )
    .get(params);

  const creditMinor = row?.credit_minor ?? 0;
  const debitMinor = row?.debit_minor ?? 0;
  return {
    credit_count: row?.credit_count ?? 0,
    debit_count: row?.debit_count ?? 0,
    total_credit: toMajorUnits(creditMinor),
    total_debit: toMajorUnits(debitMinor),
    net_amount: toMajorUnits(creditMinor - debitMinor),
  };
}

export function serializeTransaction(
  row: TransactionRow & Partial<Pick<TransactionListRow, 'account_name' | 'account_code' | 'created_by_name' | 'counterparty_account_name'>>,
) {
  return {
    id: row.id,
    organization_id: row.org_id,
    account_id: row.account_id,
    ...(row.account_name === undefined ? {} : { account_name: row.account_name }),
    ...(row.account_code === undefined ? {} : { account_code: row.account_code }),
    type: row.type,
    amount: toMajorUnits(row.amount_minor),
    amount_minor: row.amount_minor,
    balance_after: toMajorUnits(row.balance_after_minor),
    description: row.description,
    reference_id: row.reference_id,
    transfer_id: row.transfer_id,
    counterparty_account_id: row.counterparty_account_id,
    ...(row.counterparty_account_name === undefined
      ? {}
      : { counterparty_account_name: row.counterparty_account_name }),
    created_by: row.created_by,
    ...(row.created_by_name === undefined ? {} : { created_by_name: row.created_by_name }),
    created_at: row.created_at,
  };
}
