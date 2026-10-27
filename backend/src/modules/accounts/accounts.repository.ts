import type { Db } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import type { AccountRow, AccountStatus } from '../../db/types.js';
import { accountCode, newAccountId } from '../../utils/id.js';
import { toMajorUnits } from '../../utils/money.js';

export function findAccount(
  orgId: string,
  accountId: string,
  db: Db = getDb(),
): AccountRow | undefined {
  return db
    .prepare<[string, string], AccountRow>('SELECT * FROM accounts WHERE org_id = ? AND id = ?')
    .get(orgId, accountId);
}

export function insertAccount(
  input: {
    orgId: string;
    name: string;
    currency: string;
    holderEmail?: string | null;
    createdBy: string;
  },
  db: Db = getDb(),
): AccountRow {
  const now = new Date().toISOString();
  const row: AccountRow = {
    id: newAccountId(),
    org_id: input.orgId,
    code: accountCode(),
    name: input.name.trim(),
    holder_email: input.holderEmail?.trim() || null,
    currency: input.currency.toUpperCase(),
    status: 'active',
    balance_minor: 0,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO accounts
       (id, org_id, code, name, holder_email, currency, status, balance_minor, created_by, created_at, updated_at)
     VALUES (@id, @org_id, @code, @name, @holder_email, @currency, @status, @balance_minor, @created_by, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function updateAccount(
  orgId: string,
  accountId: string,
  patch: { name?: string; status?: AccountStatus; holderEmail?: string | null },
  db: Db = getDb(),
): AccountRow | undefined {
  const existing = findAccount(orgId, accountId, db);
  if (!existing) return undefined;
  const next = {
    name: patch.name?.trim() ?? existing.name,
    status: patch.status ?? existing.status,
    holder_email:
      patch.holderEmail === undefined ? existing.holder_email : patch.holderEmail?.trim() || null,
    updated_at: new Date().toISOString(),
    id: accountId,
    org_id: orgId,
  };
  db.prepare(
    `UPDATE accounts
        SET name = @name, status = @status, holder_email = @holder_email, updated_at = @updated_at
      WHERE org_id = @org_id AND id = @id`,
  ).run(next);
  return findAccount(orgId, accountId, db);
}

/** Applies a signed delta to a stored balance. Always called inside a transaction. */
export function applyBalanceDelta(
  accountId: string,
  deltaMinor: number,
  db: Db,
): void {
  db.prepare(
    'UPDATE accounts SET balance_minor = balance_minor + ?, updated_at = ? WHERE id = ?',
  ).run(deltaMinor, new Date().toISOString(), accountId);
}

export type AccountListFilters = {
  orgId: string;
  search?: string;
  status?: AccountStatus;
  sort: 'created_at' | 'name' | 'balance';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
};

const ACCOUNT_SORT_COLUMNS: Record<AccountListFilters['sort'], string> = {
  created_at: 'a.created_at',
  name: 'a.name COLLATE NOCASE',
  balance: 'a.balance_minor',
};

export type AccountListRow = AccountRow & { transaction_count: number };

export function listAccounts(
  filters: AccountListFilters,
  db: Db = getDb(),
): { rows: AccountListRow[]; total: number } {
  const where: string[] = ['a.org_id = @orgId'];
  const params: Record<string, unknown> = {
    orgId: filters.orgId,
    limit: filters.limit,
    offset: filters.offset,
  };

  if (filters.search) {
    where.push('(a.name LIKE @search COLLATE NOCASE OR a.code LIKE @search COLLATE NOCASE)');
    params.search = `%${filters.search}%`;
  }
  if (filters.status) {
    where.push('a.status = @status');
    params.status = filters.status;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const orderSql = `ORDER BY ${ACCOUNT_SORT_COLUMNS[filters.sort]} ${direction}, a.id ${direction}`;

  const total =
    db
      .prepare<Record<string, unknown>, { count: number }>(
        `SELECT COUNT(*) AS count FROM accounts a ${whereSql}`,
      )
      .get(params)?.count ?? 0;

  const rows = db
    .prepare<Record<string, unknown>, AccountListRow>(
      `SELECT a.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS transaction_count
         FROM accounts a
         ${whereSql}
         ${orderSql}
        LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  return { rows, total };
}

export function serializeAccount(row: AccountRow & { transaction_count?: number }) {
  return {
    id: row.id,
    organization_id: row.org_id,
    code: row.code,
    name: row.name,
    holder_email: row.holder_email,
    currency: row.currency,
    status: row.status,
    balance: toMajorUnits(row.balance_minor),
    balance_minor: row.balance_minor,
    ...(row.transaction_count === undefined ? {} : { transaction_count: row.transaction_count }),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
