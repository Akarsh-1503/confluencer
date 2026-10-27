import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authed,
  createAccount,
  freshApp,
  postTransaction,
  registerOwner,
  type TestContext,
} from './helpers.js';

describe('analytics', () => {
  let app: Express;
  let ctx: TestContext;
  let first: string;
  let second: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    first = (await createAccount(app, ctx, { name: 'Alpha', opening_balance: 1000 })).id;
    second = (await createAccount(app, ctx, { name: 'Beta', opening_balance: 500 })).id;

    await postTransaction(app, ctx, {
      account_id: first,
      type: 'debit',
      amount: 200,
      reference_id: 'A-DEBIT',
    });
    await postTransaction(app, ctx, {
      account_id: second,
      type: 'credit',
      amount: 100,
      reference_id: 'B-CREDIT',
    });
  });

  const api = () => authed(app, ctx.token);
  const base = () => `/api/v1/organizations/${ctx.orgId}/analytics`;

  it('summarises the organization in /overview', async () => {
    const response = await api().get(`${base()}/overview`);

    expect(response.status).toBe(200);
    expect(response.body.data.accounts).toMatchObject({ total: 2, active: 2 });
    expect(response.body.data.balances.total).toBe(1400);
    expect(response.body.data.transactions).toMatchObject({
      total: 4,
      credits: 3,
      debits: 1,
      total_credit: 1600,
      total_debit: 200,
      net_flow: 1400,
    });
    expect(response.body.data.members.total).toBe(1);
    expect(response.body.data.currency).toBe('INR');
  });

  it('returns a gap-filled daily cashflow series ending at the real balance', async () => {
    const response = await api().get(`${base()}/cashflow?days=14`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(14);
    expect(response.body.meta).toEqual({ days: 14, timezone: 'UTC' });

    const today = response.body.data[13];
    expect(today.date).toBe(new Date().toISOString().slice(0, 10));
    expect(today.credit).toBe(1600);
    expect(today.debit).toBe(200);
    expect(today.cumulative_balance).toBe(1400);

    // Days with no activity are present with zeroes, not missing.
    expect(response.body.data[0]).toMatchObject({ credit: 0, debit: 0, transaction_count: 0 });
  });

  it('validates the cashflow window', async () => {
    expect((await api().get(`${base()}/cashflow?days=0`)).status).toBe(400);
    expect((await api().get(`${base()}/cashflow?days=400`)).status).toBe(400);
    expect((await api().get(`${base()}/cashflow?days=abc`)).status).toBe(400);
  });

  it('breaks the balance down by account with shares that add up', async () => {
    const response = await api().get(`${base()}/balance-distribution`);

    expect(response.status).toBe(200);
    expect(response.body.meta.total_balance).toBe(1400);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toMatchObject({ name: 'Alpha', balance: 800 });

    const shares = response.body.data.reduce(
      (total: number, slice: { share: number }) => total + slice.share,
      0,
    );
    expect(shares).toBeCloseTo(100, 1);
  });

  it('aggregates the tail of the distribution into one slice', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createAccount(app, ctx, { name: `Tail ${i}`, opening_balance: 10 + i });
    }

    const response = await api().get(`${base()}/balance-distribution?limit=2`);
    const last = response.body.data[response.body.data.length - 1];

    expect(response.body.data).toHaveLength(3);
    expect(last.account_id).toBe('__other__');
    expect(last.name).toContain('4 accounts');
  });

  it('splits credit versus debit by count and value', async () => {
    const response = await api().get(`${base()}/type-split`);

    expect(response.status).toBe(200);
    const credit = response.body.data.find((row: { type: string }) => row.type === 'credit');
    const debit = response.body.data.find((row: { type: string }) => row.type === 'debit');

    expect(credit).toMatchObject({ count: 3, amount: 1600 });
    expect(debit).toMatchObject({ count: 1, amount: 200 });
    expect(credit.count_share + debit.count_share).toBeCloseTo(100, 1);
  });

  it('returns per-account metrics for the bubble chart', async () => {
    const response = await api().get(`${base()}/account-matrix`);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      name: 'Alpha',
      balance: 800,
      transaction_count: 2,
      total_credit: 1000,
      total_debit: 200,
      throughput: 1200,
    });
    expect(response.body.data[0].last_activity_at).toBeTruthy();
  });

  it('buckets activity by weekday and hour', async () => {
    const response = await api().get(`${base()}/activity-heatmap?days=7`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    const total = response.body.data.reduce(
      (sum: number, bucket: { count: number }) => sum + bucket.count,
      0,
    );
    expect(total).toBe(4);
    expect(response.body.data[0].hour).toBeGreaterThanOrEqual(0);
    expect(response.body.data[0].weekday).toBeLessThanOrEqual(6);
  });

  it('ranks the busiest accounts', async () => {
    const response = await api().get(`${base()}/top-accounts?limit=1`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].transaction_count).toBe(2);
  });

  it('reports a consistent ledger', async () => {
    const response = await api().get(
      `/api/v1/organizations/${ctx.orgId}/ledger/integrity`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      checked_accounts: 2,
      consistent: true,
      total_stored_balance: 1400,
      total_derived_balance: 1400,
    });
  });

  it('shows empty-but-valid analytics for a brand new organization', async () => {
    const created = await api().post('/api/v1/organizations').send({ name: 'Empty Org' });
    const overview = await api().get(
      `/api/v1/organizations/${created.body.data.id}/analytics/overview`,
    );

    expect(overview.status).toBe(200);
    expect(overview.body.data.accounts.total).toBe(0);
    expect(overview.body.data.balances.total).toBe(0);
    expect(overview.body.data.transactions.credit_share).toBe(0);
  });
});
