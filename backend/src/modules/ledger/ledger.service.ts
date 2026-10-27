import type { Db } from '../../db/index.js';
import { getDb, withTransaction } from '../../db/index.js';
import type { AccountRow, TransactionRow, TransactionType, TransferRow } from '../../db/types.js';
import { AppError } from '../../errors/AppError.js';
import { newTransferId } from '../../utils/id.js';
import { formatMajorUnits, toMajorUnits } from '../../utils/money.js';
import { applyBalanceDelta, findAccount } from '../accounts/accounts.repository.js';
import {
  findTransactionByReference,
  insertTransaction,
} from '../transactions/transactions.repository.js';

/** Hook that lets a caller write an audit row inside the same transaction. */
export type AuditHook = (db: Db) => void;

export type PostTransactionInput = {
  orgId: string;
  accountId: string;
  type: TransactionType;
  amountMinor: number;
  referenceId: string;
  description?: string | null;
  actorId: string;
};

export type TransferInput = {
  orgId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  referenceId: string;
  description?: string | null;
  actorId: string;
};

function requireAccount(orgId: string, accountId: string, field: string, db: Db): AccountRow {
  const account = findAccount(orgId, accountId, db);
  if (!account) {
    throw AppError.notFound(
      'ACCOUNT_NOT_FOUND',
      `No account exists with id "${accountId}" in this organization`,
    );
  }
  if (account.status !== 'active') {
    throw AppError.unprocessable(
      'ACCOUNT_NOT_ACTIVE',
      `Account "${account.name}" is ${account.status} and cannot take new transactions`,
      [{ field, message: `Account status is ${account.status}` }],
    );
  }
  return account;
}

function assertNoDuplicateReference(accountId: string, referenceId: string, db: Db): void {
  const existing = findTransactionByReference(accountId, referenceId, db);
  if (existing) {
    throw AppError.conflict(
      'DUPLICATE_REFERENCE_ID',
      `reference_id "${referenceId}" has already been used for this account`,
      [
        {
          field: 'reference_id',
          message: 'A transaction with this reference already exists for this account',
          existing_transaction_id: existing.id,
        },
      ],
    );
  }
}

function assertSufficientBalance(account: AccountRow, amountMinor: number): void {
  if (account.balance_minor < amountMinor) {
    throw AppError.unprocessable(
      'INSUFFICIENT_BALANCE',
      `Account "${account.name}" has ${formatMajorUnits(account.balance_minor)} available but the debit requires ${formatMajorUnits(amountMinor)}`,
      [
        {
          field: 'amount',
          message: 'Debit exceeds the available balance',
          available_balance: toMajorUnits(account.balance_minor),
          requested_amount: toMajorUnits(amountMinor),
          shortfall: toMajorUnits(amountMinor - account.balance_minor),
        },
      ],
    );
  }
}

/**
 * Writes one ledger entry and the matching balance change as a single atomic unit.
 *
 * Everything below runs inside one SQLite IMMEDIATE transaction: validation reads, the
 * transaction insert, the balance update and the audit row. If any step throws — a
 * duplicate reference, an insufficient balance, a constraint violation — the whole unit
 * rolls back and the stored balance is untouched.
 */
export function postTransaction(
  input: PostTransactionInput,
  audit?: AuditHook,
): { transaction: TransactionRow; account: AccountRow } {
  return withTransaction((db) => {
    const account = requireAccount(input.orgId, input.accountId, 'account_id', db);
    assertNoDuplicateReference(account.id, input.referenceId, db);

    const delta = input.type === 'credit' ? input.amountMinor : -input.amountMinor;
    if (input.type === 'debit') assertSufficientBalance(account, input.amountMinor);

    const balanceAfter = account.balance_minor + delta;

    const transaction = insertTransaction(
      {
        orgId: input.orgId,
        accountId: account.id,
        type: input.type,
        amountMinor: input.amountMinor,
        balanceAfterMinor: balanceAfter,
        description: input.description ?? null,
        referenceId: input.referenceId,
        createdBy: input.actorId,
      },
      db,
    );

    applyBalanceDelta(account.id, delta, db);

    const updated = findAccount(input.orgId, account.id, db);
    if (!updated) throw AppError.internal('Account disappeared while posting a transaction');
    if (updated.balance_minor !== balanceAfter) {
      // Defensive: forces a rollback rather than persisting a balance that does not
      // match the entry that was just written.
      throw AppError.internal('Balance update did not match the posted transaction');
    }

    audit?.(db);
    return { transaction, account: updated };
  });
}

/**
 * Moves money between two accounts of the same organization. The debit leg, the credit
 * leg, both balance updates and the transfer header share one transaction, so a partial
 * transfer cannot be observed or persisted.
 */
export function executeTransfer(
  input: TransferInput,
  audit?: AuditHook,
): {
  transfer: TransferRow;
  debit: TransactionRow;
  credit: TransactionRow;
  from: AccountRow;
  to: AccountRow;
} {
  if (input.fromAccountId === input.toAccountId) {
    throw AppError.validation('Source and destination accounts must be different', [
      { field: 'to_account_id', message: 'Cannot transfer to the same account' },
    ]);
  }

  return withTransaction((db) => {
    const from = requireAccount(input.orgId, input.fromAccountId, 'from_account_id', db);
    const to = requireAccount(input.orgId, input.toAccountId, 'to_account_id', db);

    if (from.currency !== to.currency) {
      throw AppError.unprocessable(
        'CURRENCY_MISMATCH',
        `Cannot transfer between accounts in different currencies (${from.currency} -> ${to.currency})`,
      );
    }

    const duplicateTransfer = db
      .prepare<[string, string], TransferRow>(
        'SELECT * FROM transfers WHERE org_id = ? AND reference_id = ?',
      )
      .get(input.orgId, input.referenceId.trim());
    if (duplicateTransfer) {
      throw AppError.conflict(
        'DUPLICATE_REFERENCE_ID',
        `reference_id "${input.referenceId}" has already been used for a transfer in this organization`,
        [
          {
            field: 'reference_id',
            message: 'A transfer with this reference already exists',
            existing_transfer_id: duplicateTransfer.id,
          },
        ],
      );
    }

    assertNoDuplicateReference(from.id, input.referenceId, db);
    assertNoDuplicateReference(to.id, input.referenceId, db);
    assertSufficientBalance(from, input.amountMinor);

    const transfer: TransferRow = {
      id: newTransferId(),
      org_id: input.orgId,
      from_account_id: from.id,
      to_account_id: to.id,
      amount_minor: input.amountMinor,
      currency: from.currency,
      reference_id: input.referenceId.trim(),
      description: input.description?.trim() || null,
      status: 'completed',
      created_by: input.actorId,
      created_at: new Date().toISOString(),
    };

    db.prepare(
      `INSERT INTO transfers
         (id, org_id, from_account_id, to_account_id, amount_minor, currency, reference_id,
          description, status, created_by, created_at)
       VALUES (@id, @org_id, @from_account_id, @to_account_id, @amount_minor, @currency, @reference_id,
          @description, @status, @created_by, @created_at)`,
    ).run(transfer);

    const debit = insertTransaction(
      {
        orgId: input.orgId,
        accountId: from.id,
        type: 'debit',
        amountMinor: input.amountMinor,
        balanceAfterMinor: from.balance_minor - input.amountMinor,
        description: transfer.description ?? `Transfer to ${to.name}`,
        referenceId: transfer.reference_id,
        transferId: transfer.id,
        counterpartyAccountId: to.id,
        createdBy: input.actorId,
      },
      db,
    );

    const credit = insertTransaction(
      {
        orgId: input.orgId,
        accountId: to.id,
        type: 'credit',
        amountMinor: input.amountMinor,
        balanceAfterMinor: to.balance_minor + input.amountMinor,
        description: transfer.description ?? `Transfer from ${from.name}`,
        referenceId: transfer.reference_id,
        transferId: transfer.id,
        counterpartyAccountId: from.id,
        createdBy: input.actorId,
      },
      db,
    );

    applyBalanceDelta(from.id, -input.amountMinor, db);
    applyBalanceDelta(to.id, input.amountMinor, db);

    const updatedFrom = findAccount(input.orgId, from.id, db);
    const updatedTo = findAccount(input.orgId, to.id, db);
    if (!updatedFrom || !updatedTo) {
      throw AppError.internal('An account disappeared while executing a transfer');
    }
    if (
      updatedFrom.balance_minor !== debit.balance_after_minor ||
      updatedTo.balance_minor !== credit.balance_after_minor
    ) {
      throw AppError.internal('Transfer legs did not reconcile with the stored balances');
    }

    audit?.(db);
    return { transfer, debit, credit, from: updatedFrom, to: updatedTo };
  });
}

export type IntegrityReport = {
  checked_accounts: number;
  consistent: boolean;
  total_stored_balance: number;
  total_derived_balance: number;
  mismatches: Array<{
    account_id: string;
    stored_balance: number;
    derived_balance: number;
    difference: number;
    transaction_count: number;
  }>;
};

/**
 * Proves the invariant "stored balance == sum of the account's transactions" for every
 * account in the organization. Surfaced through GET .../ledger/integrity and asserted in
 * the test suite.
 */
export function verifyLedgerIntegrity(orgId: string, db: Db = getDb()): IntegrityReport {
  const rows = db
    .prepare<[string], {
      account_id: string;
      stored_balance_minor: number;
      derived_balance_minor: number;
      transaction_count: number;
    }>(
      `SELECT account_id, stored_balance_minor, derived_balance_minor, transaction_count
         FROM account_derived_balances
        WHERE org_id = ?`,
    )
    .all(orgId);

  const mismatches = rows
    .filter((row) => row.stored_balance_minor !== row.derived_balance_minor)
    .map((row) => ({
      account_id: row.account_id,
      stored_balance: toMajorUnits(row.stored_balance_minor),
      derived_balance: toMajorUnits(row.derived_balance_minor),
      difference: toMajorUnits(row.stored_balance_minor - row.derived_balance_minor),
      transaction_count: row.transaction_count,
    }));

  return {
    checked_accounts: rows.length,
    consistent: mismatches.length === 0,
    total_stored_balance: toMajorUnits(rows.reduce((sum, row) => sum + row.stored_balance_minor, 0)),
    total_derived_balance: toMajorUnits(
      rows.reduce((sum, row) => sum + row.derived_balance_minor, 0),
    ),
    mismatches,
  };
}
