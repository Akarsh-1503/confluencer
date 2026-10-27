import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshApp, registerOwner, uniqueEmail } from './helpers.js';

describe('authentication', () => {
  let app: Express;

  beforeEach(() => {
    app = freshApp();
  });

  it('registers a user, creates their organization and returns a token', async () => {
    const email = uniqueEmail('owner');
    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'Akarsh S',
      email,
      password: 'Password123!',
      organization_name: 'Confluencr Media',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toBeTruthy();
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.organization).toMatchObject({
      name: 'Confluencr Media',
      role: 'OWNER',
      currency: 'INR',
    });
    expect(response.body.data.user).not.toHaveProperty('password_hash');
  });

  it('defaults the organization name when one is not supplied', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'Riya Malhotra',
      email: uniqueEmail('riya'),
      password: 'Password123!',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.organization.name).toBe("Riya's Organization");
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail('dupe');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'First', email, password: 'Password123!' });

    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Second', email, password: 'Password123!' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it.each([
    [{ email: 'not-an-email', password: 'Password123!', name: 'X' }, 'email'],
    [{ email: uniqueEmail(), password: 'short', name: 'X' }, 'password'],
    [{ email: uniqueEmail(), password: 'Password123!' }, 'name'],
  ])('rejects invalid registration payloads (%#)', async (payload, field) => {
    const response = await request(app).post('/api/v1/auth/register').send(payload);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.some((detail: { field?: string }) => detail.field === field)).toBe(
      true,
    );
  });

  it('logs in with valid credentials and lists organizations', async () => {
    const ctx = await registerOwner(app);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ctx.email, password: ctx.password });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeTruthy();
    expect(response.body.data.organizations[0].id).toBe(ctx.orgId);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    const ctx = await registerOwner(app);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ctx.email, password: 'WrongPassword1!' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'Password123!' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('returns the identity and permission set from /auth/me', async () => {
    const ctx = await registerOwner(app);
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${ctx.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(ctx.userId);
    expect(response.body.data.organizations[0].permissions).toContain('transaction:create');
    expect(response.body.data.organizations[0].permissions).toContain('org:delete');
  });

  it('rejects missing, malformed and invalid tokens', async () => {
    const missing = await request(app).get('/api/v1/auth/me');
    const malformed = await request(app).get('/api/v1/auth/me').set('authorization', 'Token abc');
    const invalid = await request(app)
      .get('/api/v1/auth/me')
      .set('authorization', 'Bearer not.a.jwt');

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
  });

  it('publishes the role -> permission matrix', async () => {
    const response = await request(app).get('/api/v1/auth/roles');
    expect(response.status).toBe(200);
    const roles = response.body.data.map((entry: { role: string }) => entry.role);
    expect(roles).toEqual(['OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER']);
  });

  it('answers the health check', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('returns 404 with a consistent envelope for unknown routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.request_id).toBeTruthy();
  });
});
