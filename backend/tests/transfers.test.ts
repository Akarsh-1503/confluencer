import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authed,
  createAccount,
  freshApp,
  getAccount,
  registerOwner,
  type TestContext,
} from './helpers.js';

describe('money transfers', () => {
  let app: Express;
  let ctx: TestContext;
  let from: string;
  let to: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    from = (await createAccount(app, ctx, { name: 'Account A', opening_balance: 100 })).id;
    to = (await createAccount(app, ctx, { name: 'Account B', opening_balance: 50 })).id;
  });

  const transfer = (body: Record<string, unknown>) =>
    authed(app, ctx.token).post(`/api/v1/organizations/${ctx.orgId}/transfers`).send(body);

  it('matches the worked example from the brief: A 100 / B 50, transfer 30 -> A 70 / B 80', async () => {
    const response = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 30,
      reference_id: 'TRF-001',
      description: 'Rebalance',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.from_account.balance).toBe(70);
    expect(response.body.data.to_account.balance).toBe(80);
    expect(response.body.data.debit_transaction).toMatchObject({
      type: 'debit',
      amount: 30,
      balance_after: 70,
    });
    expect(response.body.data.credit_transaction).toMatchObject({
      type: 'credit',
      amount: 30,
      balance_after: 80,
    });

    const a = await getAccount(app, ctx, from);
    const b = await getAccount(app, ctx, to);
    expect(a.body.data.balance).toBe(70);
    expect(b.body.data.balance).toBe(80);
  });

  it('writes both legs linked to the transfer header', async () => {
    const created = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 25,
      reference_id: 'TRF-LEGS',
    });

    const detail = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transfers/${created.body.data.id}`,
    );

    expect(detail.status).toBe(200);
    expect(detail.body.data.legs).toHaveLength(2);
    expect(detail.body.data.legs.map((leg: { type: string }) => leg.type).sort()).toEqual([
      'credit',
      'debit',
    ]);
    expect(
      detail.body.data.legs.every((leg: { transfer_id: string }) => leg.transfer_id === created.body.data.id),
    ).toBe(true);
  });

  it('rolls back completely when the source has insufficient balance', async () => {
    const response = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 500,
      reference_id: 'TRF-OVERDRAW',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const a = await getAccount(app, ctx, from);
    const b = await getAccount(app, ctx, to);
    expect(a.body.data.balance).toBe(100);
    expect(b.body.data.balance).toBe(50);

    const transfers = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transfers`,
    );
    expect(transfers.body.data).toHaveLength(0);

    const ledger = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transactions?reference_id=TRF-OVERDRAW`,
    );
    expect(ledger.body.data).toHaveLength(0);
  });

  it('rejects a transfer when either account does not exist', async () => {
    const badSource = await transfer({
      from_account_id: 'acc_missing',
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-BAD-SRC',
    });
    const badTarget = await transfer({
      from_account_id: from,
      to_account_id: 'acc_missing',
      amount: 10,
      reference_id: 'TRF-BAD-DST',
    });

    expect(badSource.status).toBe(404);
    expect(badTarget.status).toBe(404);
    expect(badTarget.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const a = await getAccount(app, ctx, from);
    expect(a.body.data.balance).toBe(100);
  });

  it('rejects a transfer to an account in another organization', async () => {
    const other = await registerOwner(app);
    const foreign = await createAccount(app, other, { name: 'Foreign Account' });

    const response = await transfer({
      from_account_id: from,
      to_account_id: foreign.id,
      amount: 10,
      reference_id: 'TRF-CROSS-ORG',
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('rejects a self-transfer', async () => {
    const response = await transfer({
      from_account_id: from,
      to_account_id: from,
      amount: 10,
      reference_id: 'TRF-SELF',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('to_account_id');
  });

  it('rejects a duplicate transfer reference', async () => {
    await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-DUP',
    });
    const second = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-DUP',
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_REFERENCE_ID');

    const a = await getAccount(app, ctx, from);
    expect(a.body.data.balance).toBe(90);
  });

  it.each([0, -10, '0.001'])('rejects a non-positive or over-precise amount %j', async (amount) => {
    const response = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount,
      reference_id: `TRF-BAD-AMOUNT-${amount}`,
    });

    expect(response.status).toBe(400);
  });

  it('refuses a transfer involving a frozen account', async () => {
    await authed(app, ctx.token)
      .patch(`/api/v1/organizations/${ctx.orgId}/accounts/${to}`)
      .send({ status: 'frozen' });

    const response = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-FROZEN',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('keeps the organization total unchanged and the ledger consistent', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await transfer({
        from_account_id: i % 2 === 0 ? from : to,
        to_account_id: i % 2 === 0 ? to : from,
        amount: 10,
        reference_id: `TRF-LOOP-${i}`,
      });
      expect(response.status).toBe(201);
    }

    const overview = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/analytics/overview`,
    );
    expect(overview.body.data.balances.total).toBe(150);

    const integrity = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/ledger/integrity`,
    );
    expect(integrity.body.data.consistent).toBe(true);
  });

  it('is immutable once executed', async () => {
    const created = await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-IMMUTABLE',
    });
    const url = `/api/v1/organizations/${ctx.orgId}/transfers/${created.body.data.id}`;

    for (const verb of ['put', 'patch', 'delete'] as const) {
      const response = await authed(app, ctx.token)[verb](url).send({ amount: 1 });
      expect(response.status).toBe(405);
      expect(response.body.error.code).toBe('TRANSFER_IMMUTABLE');
    }
  });

  it('lists transfers filtered by account', async () => {
    const third = await createAccount(app, ctx, { name: 'Account C', opening_balance: 10 });
    await transfer({
      from_account_id: from,
      to_account_id: to,
      amount: 10,
      reference_id: 'TRF-LIST-1',
    });
    await transfer({
      from_account_id: third.id,
      to_account_id: to,
      amount: 5,
      reference_id: 'TRF-LIST-2',
    });

    const all = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transfers?limit=10`,
    );
    const filtered = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/transfers?account_id=${third.id}`,
    );

    expect(all.body.data).toHaveLength(2);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].reference_id).toBe('TRF-LIST-2');
    expect(filtered.body.data[0].from_account_name).toBe('Account C');
  });
});
