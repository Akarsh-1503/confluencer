import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDb, openDatabase, useDatabase } from '../src/db/index.js';
import type { Role } from '../src/rbac/permissions.js';

export type TestContext = {
  app: Express;
  token: string;
  userId: string;
  orgId: string;
};

/** Fresh in-memory database + app for a single test. */
export function freshApp(): Express {
  closeDb();
  useDatabase(openDatabase(':memory:'));
  return createApp();
}

let emailCounter = 0;
export function uniqueEmail(prefix = 'user'): string {
  emailCounter += 1;
  return `${prefix}.${emailCounter}.${process.pid}@example.test`;
}

export async function registerOwner(
  app: Express,
  overrides: Partial<{ name: string; email: string; password: string; organization_name: string }> = {},
): Promise<TestContext & { email: string; password: string }> {
  const email = overrides.email ?? uniqueEmail('owner');
  const password = overrides.password ?? 'Password123!';
  const response = await request(app).post('/api/v1/auth/register').send({
    name: overrides.name ?? 'Test Owner',
    email,
    password,
    organization_name: overrides.organization_name ?? 'Test Organization',
  });

  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return {
    app,
    token: response.body.data.token,
    userId: response.body.data.user.id,
    orgId: response.body.data.organization.id,
    email,
    password,
  };
}

/** Adds a member with `role` and logs in as them, returning their bearer token. */
export async function addMemberAndLogin(
  app: Express,
  ctx: TestContext,
  role: Role,
): Promise<{ token: string; userId: string; email: string }> {
  const email = uniqueEmail(role.toLowerCase());
  const created = await request(app)
    .post(`/api/v1/organizations/${ctx.orgId}/members`)
    .set('authorization', `Bearer ${ctx.token}`)
    .send({ email, role, name: `${role} User` });

  if (created.status !== 201) {
    throw new Error(`add member failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: created.body.data.temporary_password });

  if (login.status !== 200) {
    throw new Error(`member login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  return { token: login.body.data.token, userId: created.body.data.user.id, email };
}

export async function createAccount(
  app: Express,
  ctx: TestContext,
  body: Record<string, unknown>,
): Promise<{ id: string; balance: number; code: string }> {
  const response = await request(app)
    .post(`/api/v1/organizations/${ctx.orgId}/accounts`)
    .set('authorization', `Bearer ${ctx.token}`)
    .send(body);

  if (response.status !== 201) {
    throw new Error(`create account failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export function postTransaction(
  app: Express,
  ctx: TestContext,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/organizations/${ctx.orgId}/transactions`)
    .set('authorization', `Bearer ${ctx.token}`)
    .send(body);
}

export function getAccount(app: Express, ctx: TestContext, accountId: string) {
  return request(app)
    .get(`/api/v1/organizations/${ctx.orgId}/accounts/${accountId}`)
    .set('authorization', `Bearer ${ctx.token}`);
}

export function authed(app: Express, token: string) {
  return {
    get: (url: string) => request(app).get(url).set('authorization', `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set('authorization', `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set('authorization', `Bearer ${token}`),
    put: (url: string) => request(app).put(url).set('authorization', `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set('authorization', `Bearer ${token}`),
  };
}
