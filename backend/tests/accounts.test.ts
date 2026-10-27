import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { authed, createAccount, freshApp, registerOwner, type TestContext } from './helpers.js';

describe('accounts', () => {
  let app: Express;
  let ctx: TestContext;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
  });

  it('creates an account with a zero balance', async () => {
    const response = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/accounts`)
      .send({ name: 'Operating Account' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'Operating Account',
      balance: 0,
      status: 'active',
      currency: 'INR',
    });
    expect(response.body.data.code).toMatch(/^AC-/);
  });

  it('requires a name', async () => {
    const missing = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/accounts`)
      .send({});
    const blank = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/accounts`)
      .send({ name: '   ' });

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details[0].field).toBe('name');
    expect(blank.status).toBe(400);
  });

  it('rejects a duplicate account name inside the same organization', async () => {
    await createAccount(app, ctx, { name: 'Payouts' });
    const duplicate = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/accounts`)
      .send({ name: 'Payouts' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ACCOUNT_NAME_TAKEN');
  });

  it('allows the same account name in a different organization', async () => {
    await createAccount(app, ctx, { name: 'Payouts' });

    const second = await authed(app, ctx.token)
      .post('/api/v1/organizations')
      .send({ name: 'Second Org' });
    const response = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${second.body.data.id}/accounts`)
      .send({ name: 'Payouts' });

    expect(response.status).toBe(201);
  });

  it('records an opening balance as a credit transaction', async () => {
    const account = await createAccount(app, ctx, {
      name: 'Seeded Account',
      opening_balance: 2500.5,
    });

    expect(account.balance).toBe(2500.5);

    const transactions = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts/${account.id}/transactions`,
    );
    expect(transactions.body.data).toHaveLength(1);
    expect(transactions.body.data[0]).toMatchObject({
      type: 'credit',
      amount: 2500.5,
      description: 'Opening balance',
    });
  });

  it('reads one account and 404s on an unknown id', async () => {
    const account = await createAccount(app, ctx, { name: 'Readable' });

    const found = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts/${account.id}`,
    );
    const missing = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts/acc_does_not_exist`,
    );

    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(account.id);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('never exposes a way to write the balance directly', async () => {
    const account = await createAccount(app, ctx, { name: 'Protected', opening_balance: 100 });

    const response = await authed(app, ctx.token)
      .patch(`/api/v1/organizations/${ctx.orgId}/accounts/${account.id}`)
      .send({ name: 'Renamed', balance: 999999, balance_minor: 999999 });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Renamed');
    expect(response.body.data.balance).toBe(100);
  });

  it('refuses to close an account that still holds money', async () => {
    const account = await createAccount(app, ctx, { name: 'Funded', opening_balance: 50 });

    const response = await authed(app, ctx.token)
      .patch(`/api/v1/organizations/${ctx.orgId}/accounts/${account.id}`)
      .send({ status: 'closed' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_EMPTY');
  });

  it('blocks transactions on a frozen account', async () => {
    const account = await createAccount(app, ctx, { name: 'Frozen Account' });
    await authed(app, ctx.token)
      .patch(`/api/v1/organizations/${ctx.orgId}/accounts/${account.id}`)
      .send({ status: 'frozen' });

    const response = await authed(app, ctx.token)
      .post(`/api/v1/organizations/${ctx.orgId}/transactions`)
      .send({ account_id: account.id, type: 'credit', amount: 10, reference_id: 'FROZEN-1' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('filters, sorts and paginates the account list', async () => {
    await createAccount(app, ctx, { name: 'Alpha Account', opening_balance: 300 });
    await createAccount(app, ctx, { name: 'Beta Account', opening_balance: 100 });
    await createAccount(app, ctx, { name: 'Gamma Reserve', opening_balance: 200 });

    const search = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts?q=account`,
    );
    expect(search.body.data).toHaveLength(2);

    const byBalance = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts?sort=balance&order=desc`,
    );
    expect(byBalance.body.data.map((row: { balance: number }) => row.balance)).toEqual([
      300, 200, 100,
    ]);

    const paged = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts?page=2&limit=2&sort=name&order=asc`,
    );
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total_records: 3,
      total_pages: 2,
      has_next_page: false,
      has_previous_page: true,
    });
  });

  it('isolates accounts between organizations', async () => {
    const account = await createAccount(app, ctx, { name: 'Private Account' });
    const other = await registerOwner(app);

    const crossRead = await authed(app, other.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts/${account.id}`,
    );
    expect(crossRead.status).toBe(403);
    expect(crossRead.body.error.code).toBe('ORG_ACCESS_DENIED');

    const list = await authed(app, other.token).get(
      `/api/v1/organizations/${other.orgId}/accounts`,
    );
    expect(list.body.data).toHaveLength(0);
  });
});
