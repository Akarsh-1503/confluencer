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

const TOTAL = 25;

describe('pagination, sorting and filtering', () => {
  let app: Express;
  let ctx: TestContext;
  let accountId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    accountId = (await createAccount(app, ctx, { name: 'Main Account' })).id;
    otherAccountId = (await createAccount(app, ctx, { name: 'Side Account' })).id;

    for (let i = 0; i < TOTAL; i += 1) {
      const response = await postTransaction(app, ctx, {
        account_id: i % 5 === 0 ? otherAccountId : accountId,
        // Every third entry is a debit, except the first one on each account: credits
        // are large and debits are tiny, so no entry is ever rejected for funds.
        type: i % 3 === 0 && i !== 0 ? 'debit' : 'credit',
        amount: i % 3 === 0 && i !== 0 ? 1 : 100 + i,
        reference_id: `REF-${String(i).padStart(3, '0')}`,
        description: i % 2 === 0 ? `even entry ${i}` : `odd entry ${i}`,
      });
      expect(response.status).toBe(201);
    }
  });

  const list = (query: string) =>
    authed(app, ctx.token).get(`/api/v1/organizations/${ctx.orgId}/transactions${query}`);

  it('returns the documented pagination envelope', async () => {
    const response = await list('?page=1&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(10);
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 10,
      total_records: TOTAL,
      total_pages: 3,
      has_next_page: true,
      has_previous_page: false,
    });
  });

  it('defaults to page 1 with a limit of 20', async () => {
    const response = await list('');
    expect(response.body.data).toHaveLength(20);
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 20 });
  });

  it('walks every page without repeating or dropping a record', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await list(`?page=${page}&limit=10`);
      seen.push(...response.body.data.map((row: { id: string }) => row.id));
    }

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it('returns an empty page past the end rather than an error', async () => {
    const response = await list('?page=99&limit=10');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.pagination).toMatchObject({
      page: 99,
      total_records: TOTAL,
      has_next_page: false,
      has_previous_page: true,
    });
  });

  it('sorts latest-first on created_at by default', async () => {
    const response = await list('?limit=25');
    const timestamps = response.body.data.map((row: { created_at: string }) => row.created_at);
    const sorted = [...timestamps].sort().reverse();

    expect(timestamps).toEqual(sorted);
    // The newest reference was written last.
    expect(response.body.data[0].reference_id).toBe('REF-024');
    expect(response.body.meta.sort).toEqual({ field: 'created_at', order: 'desc' });
  });

  it('supports oldest-first and amount ordering', async () => {
    const oldest = await list('?limit=3&order=asc');
    expect(oldest.body.data[0].reference_id).toBe('REF-000');

    const byAmount = await list('?limit=3&sort=amount&order=desc');
    const amounts = byAmount.body.data.map((row: { amount: number }) => row.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it.each([
    ['?page=0', 'page'],
    ['?limit=0', 'limit'],
    ['?page=-1', 'page'],
    ['?limit=1000', 'limit'],
    ['?page=abc', 'page'],
    ['?limit=1.5', 'limit'],
  ])('rejects invalid pagination %s', async (query, field) => {
    const response = await list(query);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PAGINATION');
    expect(response.body.error.details[0].field).toBe(field);
  });

  it('filters by account, type, reference and description', async () => {
    const byAccount = await list(`?account_id=${otherAccountId}&limit=100`);
    expect(byAccount.body.data.every((row: { account_id: string }) => row.account_id === otherAccountId)).toBe(
      true,
    );

    const byType = await list('?type=debit&limit=100');
    expect(byType.body.data.every((row: { type: string }) => row.type === 'debit')).toBe(true);

    const byReference = await list('?reference_id=REF-007');
    expect(byReference.body.data).toHaveLength(1);

    const bySearch = await list('?q=odd%20entry&limit=100');
    expect(bySearch.body.data.length).toBeGreaterThan(0);
    expect(
      bySearch.body.data.every((row: { description: string }) => row.description.includes('odd')),
    ).toBe(true);
  });

  it('filters by amount range and rejects an inverted range', async () => {
    const inRange = await list('?min_amount=100&max_amount=110&limit=100');
    expect(
      inRange.body.data.every((row: { amount: number }) => row.amount >= 100 && row.amount <= 110),
    ).toBe(true);

    const inverted = await list('?min_amount=500&max_amount=100');
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('INVALID_FILTER');
  });

  it('filters by date window and rejects a reversed window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const inWindow = await list(`?from=${today}T00:00:00.000Z&limit=100`);
    expect(inWindow.body.data.length).toBe(TOTAL);

    const reversed = await list(
      `?from=${today}T23:59:59.000Z&to=${today}T00:00:00.000Z`,
    );
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.code).toBe('INVALID_FILTER');
  });

  it('rejects an unparseable date filter', async () => {
    const response = await list('?from=yesterday');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports filtered totals alongside the page', async () => {
    const response = await list('?type=credit&limit=100');
    const sum = response.body.data.reduce(
      (total: number, row: { amount: number }) => total + row.amount,
      0,
    );

    expect(response.body.meta.totals.total_credit).toBeCloseTo(sum, 2);
    expect(response.body.meta.totals.total_debit).toBe(0);
  });

  it('paginates the nested per-account ledger', async () => {
    const response = await authed(app, ctx.token).get(
      `/api/v1/organizations/${ctx.orgId}/accounts/${otherAccountId}/transactions?limit=2`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.filters.account_id).toBe(otherAccountId);
  });
});
