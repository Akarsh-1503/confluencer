import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authed,
  createAccount,
  freshApp,
  getAccount,
  postTransaction,
  registerOwner,
  type TestContext,
} from './helpers.js';

describe('transactions', () => {
  let app: Express;
  let ctx: TestContext;
  let accountId: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    const account = await createAccount(app, ctx, { name: 'Ledger Account' });
    accountId = account.id;
  });

  it('creates a credit and moves the balance', async () => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 100,
      reference_id: 'INV-001',
      description: 'Brand campaign invoice',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      type: 'credit',
      amount: 100,
      balance_after: 100,
      reference_id: 'INV-001',
    });
    expect(response.body.data.account.balance).toBe(100);
  });

  it('matches the worked example from the brief: 0 +100 +50 -30 -20 = 100', async () => {
    const steps: Array<['credit' | 'debit', number, number]> = [
      ['credit', 100, 100],
      ['credit', 50, 150],
      ['debit', 30, 120],
      ['debit', 20, 100],
    ];

    for (const [index, [type, amount, expectedBalance]] of steps.entries()) {
      const response = await postTransaction(app, ctx, {
        account_id: accountId,
        type,
        amount,
        reference_id: `STEP-${index}`,
      });
      expect(response.status).toBe(201);
      expect(response.body.data.balance_after).toBe(expectedBalance);
    }

    const account = await getAccount(app, ctx, accountId);
    expect(account.body.data.balance).toBe(100);
  });

  it('rejects a debit that exceeds the balance and leaves the balance untouched', async () => {
    await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 40,
      reference_id: 'SEED-1',
    });

    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'debit',
      amount: 70,
      reference_id: 'OVERDRAW-1',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(response.body.error.details[0]).toMatchObject({
      available_balance: 40,
      requested_amount: 70,
      shortfall: 30,
    });

    const account = await getAccount(app, ctx, accountId);
    expect(account.body.data.balance).toBe(40);

    // The rejected attempt must not be recorded in the ledger.
    const list = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transactions?reference_id=OVERDRAW-1`,
    );
    expect(list.body.data).toHaveLength(0);
  });

  it('allows a debit that empties the account exactly', async () => {
    await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 25.5,
      reference_id: 'EXACT-IN',
    });
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'debit',
      amount: 25.5,
      reference_id: 'EXACT-OUT',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.balance_after).toBe(0);
  });

  it('rejects a duplicate reference_id for the same account', async () => {
    const first = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
      reference_id: 'DUP-1',
    });
    const second = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
      reference_id: 'DUP-1',
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_REFERENCE_ID');
    expect(second.body.error.details[0].existing_transaction_id).toBe(first.body.data.id);

    const account = await getAccount(app, ctx, accountId);
    expect(account.body.data.balance).toBe(10);
  });

  it('allows the same reference_id on a different account', async () => {
    const other = await createAccount(app, ctx, { name: 'Second Account' });

    await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
      reference_id: 'SHARED-REF',
    });
    const response = await postTransaction(app, ctx, {
      account_id: other.id,
      type: 'credit',
      amount: 10,
      reference_id: 'SHARED-REF',
    });

    expect(response.status).toBe(201);
  });

  it('404s when the account does not exist', async () => {
    const response = await postTransaction(app, ctx, {
      account_id: 'acc_missing',
      type: 'credit',
      amount: 10,
      reference_id: 'NO-ACCOUNT',
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('404s when the account belongs to another organization', async () => {
    const other = await registerOwner(app);
    const foreignAccount = await createAccount(app, other, { name: 'Foreign Account' });

    const response = await postTransaction(app, ctx, {
      account_id: foreignAccount.id,
      type: 'credit',
      amount: 10,
      reference_id: 'CROSS-ORG',
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it.each([
    ['transfer', 'type'],
    ['CREDIT ', 'type'],
    ['', 'type'],
  ])('rejects invalid transaction type %j', async (type, field) => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type,
      amount: 10,
      reference_id: `BAD-TYPE-${String(type).trim() || 'blank'}`,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe(field);
  });

  it.each([0, -5, '0', '-0.01'])('rejects non-positive amount %j', async (amount) => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount,
      reference_id: `BAD-AMOUNT-${amount}`,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toMatch(/greater than 0/);
  });

  it.each([
    ['abc', /numeric|decimal/],
    [1.005, /2 decimal places/],
    [null, /number or a numeric string/],
  ])('rejects malformed amount %j', async (amount, pattern) => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount,
      reference_id: `MALFORMED-${String(amount)}`,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toMatch(pattern);
  });

  it('accepts amounts as decimal strings and keeps exact precision', async () => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: '1234.56',
      reference_id: 'STRING-AMOUNT',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.amount).toBe(1234.56);
    expect(response.body.data.amount_minor).toBe(123456);
  });

  it('keeps cents exact across many fractional operations', async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await postTransaction(app, ctx, {
        account_id: accountId,
        type: 'credit',
        amount: '0.10',
        reference_id: `CENTS-${i}`,
      });
      expect(response.status).toBe(201);
    }

    const account = await getAccount(app, ctx, accountId);
    expect(account.body.data.balance).toBe(3);
    expect(account.body.data.balance_minor).toBe(300);
  });

  it('requires reference_id', async () => {
    const response = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('reference_id');
  });

  it('rejects a malformed JSON body', async () => {
    const response = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/transactions`)
      .set('content-type', 'application/json')
      .send('{"account_id": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });

  it('returns a single transaction and 404s for an unknown id', async () => {
    const created = await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
      reference_id: 'ONE',
    });

    const found = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transactions/${created.body.data.id}`,
    );
    const missing = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transactions/txn_nope`,
    );

    expect(found.status).toBe(200);
    expect(found.body.data.reference_id).toBe('ONE');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('exports the filtered ledger as CSV', async () => {
    await postTransaction(app, ctx, {
      account_id: accountId,
      type: 'credit',
      amount: 10,
      reference_id: 'CSV-1',
      description: 'With, a comma',
    });

    const response = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.text.split('\n')[0]).toContain('reference_id');
    expect(response.text).toContain('"With, a comma"');
  });
});
