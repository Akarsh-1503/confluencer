import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/index.js';
import { postTransaction as postLedgerEntry } from '../src/modules/ledger/ledger.service.js';
import {
  authed,
  createAccount,
  freshApp,
  getAccount,
  postTransaction,
  registerOwner,
  type TestContext,
} from './helpers.js';

describe('data integrity', () => {
  let app: Express;
  let ctx: TestContext;
  let accountId: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    accountId = (await createAccount(app, ctx, { name: 'Integrity Account' })).id;
  });

  describe('immutability', () => {
    it('answers 405 for every mutating verb on a transaction', async () => {
      const created = await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 10,
        reference_id: 'IMMUTABLE-1',
      });
      const url = `/api/v1/organizations/${ctx.orgId}/transactions/${created.body.data.id}`;

      for (const verb of ['put', 'patch', 'delete'] as const) {
        const response = await authed(app, ctx.token)[verb](url).send({ amount: 9999 });
        expect(response.status).toBe(405);
        expect(response.body.error.code).toBe('TRANSACTION_IMMUTABLE');
      }
    });

    it('keeps every immutable field byte-identical after further activity', async () => {
      const created = await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 125.75,
        reference_id: 'SNAPSHOT-1',
        description: 'Original description',
      });
      const before = created.body.data;

      await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'debit',
        amount: 25,
        reference_id: 'SNAPSHOT-2',
      });

      const after = await authed(app, ctx.token).get(
        `/api/v1/organizations/${ctx.orgId}/transactions/${before.id}`,
      );

      for (const field of [
        'id',
        'account_id',
        'type',
        'amount',
        'amount_minor',
        'description',
        'reference_id',
        'created_at',
        'balance_after',
      ]) {
        expect(after.body.data[field]).toEqual(before[field]);
      }
    });

    it('blocks UPDATE and DELETE at the database level', async () => {
      await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 10,
        reference_id: 'DB-GUARD-1',
      });
      const db = getDb();

      expect(() => db.prepare('UPDATE transactions SET amount_minor = 1').run()).toThrow(
        /TRANSACTION_IMMUTABLE/,
      );
      expect(() => db.prepare('DELETE FROM transactions').run()).toThrow(/TRANSACTION_IMMUTABLE/);
    });
  });

  describe('balance consistency', () => {
    it('keeps stored balances equal to the sum of their transactions', async () => {
      const second = await createAccount(app, ctx, { name: 'Second Account' });

      const entries: Array<[string, 'credit' | 'debit', number]> = [
        [accountId, 'credit', 1000],
        [accountId, 'credit', 250.25],
        [accountId, 'debit', 125.5],
        [second.id, 'credit', 900],
        [second.id, 'debit', 400.75],
        [accountId, 'debit', 0.75],
      ];

      for (const [index, [account, type, amount]] of entries.entries()) {
        const response = await postTransaction(app, ctx, {
          account_id: account,
          type,
          amount,
          reference_id: `CONSISTENCY-${index}`,
        });
        expect(response.status).toBe(201);
      }

      const first = await getAccount(app, ctx, accountId);
      expect(first.body.data.balance).toBe(1124);

      const other = await getAccount(app, ctx, second.id);
      expect(other.body.data.balance).toBe(499.25);

      const integrity = await authed(app, ctx.token).get(
        `/api/v1/organizations/${ctx.orgId}/ledger/integrity`,
      );
      expect(integrity.status).toBe(200);
      expect(integrity.body.data.consistent).toBe(true);
      expect(integrity.body.data.mismatches).toEqual([]);
      expect(integrity.body.data.total_stored_balance).toBe(1623.25);
    });

    it('is unaffected by rejected transactions', async () => {
      await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 100,
        reference_id: 'BASE',
      });

      const rejected = await Promise.all([
        postTransaction(app, ctx, {
          account_id: accountId,
          type: 'debit',
          amount: 500,
          reference_id: 'REJECT-OVERDRAW',
        }),
        postTransaction(app, ctx, {
          account_id: accountId,
          type: 'credit',
          amount: -10,
          reference_id: 'REJECT-NEGATIVE',
        }),
        postTransaction(app, ctx, {
          account_id: accountId,
          type: 'credit',
          amount: 10,
          reference_id: 'BASE',
        }),
        postTransaction(app, ctx, {
          account_id: 'acc_missing',
          type: 'credit',
          amount: 10,
          reference_id: 'REJECT-NO-ACCOUNT',
        }),
      ]);

      expect(rejected.map((response) => response.status)).toEqual([422, 400, 409, 404]);

      const account = await getAccount(app, ctx, accountId);
      expect(account.body.data.balance).toBe(100);

      const integrity = await authed(app, ctx.token).get(
        `/api/v1/organizations/${ctx.orgId}/ledger/integrity`,
      );
      expect(integrity.body.data.consistent).toBe(true);
    });

    it('never lets a balance go negative, even under a burst of debits', async () => {
      await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 100,
        reference_id: 'BURST-SEED',
      });

      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          postTransaction(app, ctx, {
            account_id: accountId,
            type: 'debit',
            amount: 20,
            reference_id: `BURST-${index}`,
          }),
        ),
      );

      const accepted = attempts.filter((response) => response.status === 201);
      const rejectedCount = attempts.filter((response) => response.status === 422).length;

      expect(accepted).toHaveLength(5);
      expect(rejectedCount).toBe(7);

      const account = await getAccount(app, ctx, accountId);
      expect(account.body.data.balance).toBe(0);
      expect(account.body.data.balance_minor).toBeGreaterThanOrEqual(0);
    });
  });

  describe('atomicity', () => {
    it('rolls back the transaction row when the audit write inside the unit fails', async () => {
      await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: 500,
        reference_id: 'ATOMIC-SEED',
      });

      expect(() =>
        postLedgerEntry(
          {
            orgId: ctx.orgId,
            accountId,
            type: 'debit',
            amountMinor: 10_000,
            referenceId: 'ATOMIC-FAIL',
            actorId: ctx.userId,
          },
          () => {
            // Simulates any late failure in the same unit of work (audit sink down,
            // constraint violation, crash in a downstream write).
            throw new Error('audit sink unavailable');
          },
        ),
      ).toThrow(/audit sink unavailable/);

      const account = await getAccount(app, ctx, accountId);
      expect(account.body.data.balance).toBe(500);

      const list = await authed(app, ctx.token).get(
        `/api/v1/organizations/${ctx.orgId}/transactions?reference_id=ATOMIC-FAIL`,
      );
      expect(list.body.data).toHaveLength(0);

      const integrity = await authed(app, ctx.token).get(
        `/api/v1/organizations/${ctx.orgId}/ledger/integrity`,
      );
      expect(integrity.body.data.consistent).toBe(true);
    });

    it('writes the entry and the balance together or not at all', async () => {
      const db = getDb();
      const before = db
        .prepare('SELECT COUNT(*) AS count FROM transactions')
        .get() as { count: number };

      const failed = await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'debit',
        amount: 10,
        reference_id: 'NO-FUNDS',
      });
      expect(failed.status).toBe(422);

      const after = db
        .prepare('SELECT COUNT(*) AS count FROM transactions')
        .get() as { count: number };
      expect(after.count).toBe(before.count);
    });
  });
});
