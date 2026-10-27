import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../src/rbac/permissions.js';
import {
  addMemberAndLogin,
  authed,
  createAccount,
  freshApp,
  registerOwner,
  uniqueEmail,
  type TestContext,
} from './helpers.js';

describe('organization authorization', () => {
  let app: Express;
  let ctx: TestContext;
  let accountId: string;

  beforeEach(async () => {
    app = freshApp();
    ctx = await registerOwner(app);
    accountId = (await createAccount(app, ctx, { name: 'Shared Account', opening_balance: 500 })).id;
  });

  const base = () => `/api/v1/organizations/${ctx.orgId}`;

  it('adds members for every role and returns their permissions', async () => {
    for (const role of ['ADMIN', 'EDITOR', 'AUDITOR', 'READER'] as Role[]) {
      const response = await authed(app, ctx.token)
        .post(`${base()}/members`)
        .send({ email: uniqueEmail(role.toLowerCase()), role });

      expect(response.status).toBe(201);
      expect(response.body.data.role).toBe(role);
      expect(response.body.data.temporary_password).toBeTruthy();
    }

    const members = await authed(app, ctx.token).get(`${base()}/members`);
    expect(members.body.data).toHaveLength(5);
    expect(members.body.data[0].role).toBe('OWNER');
  });

  it('rejects an unknown role', async () => {
    const response = await authed(app, ctx.token)
      .post(`${base()}/members`)
      .send({ email: uniqueEmail(), role: 'SUPERUSER' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toMatch(/role must be one of/);
  });

  describe('read-only roles', () => {
    it('lets a READER read but not write', async () => {
      const reader = await addMemberAndLogin(app, ctx, 'READER');
      const api = authed(app, reader.token);

      const read = await api.get(`${base()}/transactions`);
      expect(read.status).toBe(200);

      const write = await api.post(`${base()}/transactions`).send({
        account_id: accountId,
        type: 'credit',
        amount: 10,
        reference_id: 'READER-WRITE',
      });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('INSUFFICIENT_ROLE');
      expect(write.body.error.details[0].required_permission).toBe('transaction:create');

      const createAccountAttempt = await api.post(`${base()}/accounts`).send({ name: 'Nope' });
      expect(createAccountAttempt.status).toBe(403);

      const transferAttempt = await api.post(`${base()}/transfers`).send({
        from_account_id: accountId,
        to_account_id: accountId,
        amount: 1,
        reference_id: 'READER-TRANSFER',
      });
      expect(transferAttempt.status).toBe(403);
    });

    it('denies a READER access to the audit trail but allows an AUDITOR', async () => {
      const reader = await addMemberAndLogin(app, ctx, 'READER');
      const auditor = await addMemberAndLogin(app, ctx, 'AUDITOR');

      const denied = await authed(app, reader.token).get(`${base()}/audit-logs`);
      const allowed = await authed(app, auditor.token).get(`${base()}/audit-logs`);

      expect(denied.status).toBe(403);
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.length).toBeGreaterThan(0);
      expect(allowed.body.meta.pagination.total_records).toBeGreaterThan(0);
    });

    it('denies an AUDITOR any write access', async () => {
      const auditor = await addMemberAndLogin(app, ctx, 'AUDITOR');
      const response = await authed(app, auditor.token).post(`${base()}/transactions`).send({
        account_id: accountId,
        type: 'credit',
        amount: 10,
        reference_id: 'AUDITOR-WRITE',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('EDITOR', () => {
    it('can move money but cannot administer the organization', async () => {
      const editor = await addMemberAndLogin(app, ctx, 'EDITOR');
      const api = authed(app, editor.token);

      const posted = await api.post(`${base()}/transactions`).send({
        account_id: accountId,
        type: 'credit',
        amount: 100,
        reference_id: 'EDITOR-CREDIT',
      });
      expect(posted.status).toBe(201);

      const createdAccount = await api.post(`${base()}/accounts`).send({ name: 'Editor Account' });
      expect(createdAccount.status).toBe(201);

      const renamed = await api
        .patch(`${base()}/accounts/${accountId}`)
        .send({ name: 'Renamed by editor' });
      expect(renamed.status).toBe(403);
      expect(renamed.body.error.details[0].required_permission).toBe('account:update');

      const invited = await api.post(`${base()}/members`).send({
        email: uniqueEmail(),
        role: 'READER',
      });
      expect(invited.status).toBe(403);

      const orgUpdate = await api.patch(base()).send({ name: 'Editor Corp' });
      expect(orgUpdate.status).toBe(403);
    });
  });

  describe('ADMIN', () => {
    it('can manage accounts and members', async () => {
      const admin = await addMemberAndLogin(app, ctx, 'ADMIN');
      const api = authed(app, admin.token);

      expect((await api.patch(`${base()}/accounts/${accountId}`).send({ name: 'Admin Rename' })).status).toBe(
        200,
      );
      expect((await api.patch(base()).send({ name: 'Admin Renamed Org' })).status).toBe(200);
      expect(
        (await api.post(`${base()}/members`).send({ email: uniqueEmail(), role: 'READER' })).status,
      ).toBe(201);
      expect((await api.get(`${base()}/audit-logs`)).status).toBe(200);
    });

    it('cannot grant or modify the OWNER role', async () => {
      const admin = await addMemberAndLogin(app, ctx, 'ADMIN');
      const api = authed(app, admin.token);

      const grantOwner = await api
        .post(`${base()}/members`)
        .send({ email: uniqueEmail(), role: 'OWNER' });
      expect(grantOwner.status).toBe(403);
      expect(grantOwner.body.error.code).toBe('ROLE_ESCALATION_BLOCKED');

      const demoteOwner = await api
        .patch(`${base()}/members/${ctx.userId}`)
        .send({ role: 'READER' });
      expect(demoteOwner.status).toBe(403);
      expect(demoteOwner.body.error.code).toBe('ROLE_ESCALATION_BLOCKED');

      const removeOwner = await api.delete(`${base()}/members/${ctx.userId}`);
      expect(removeOwner.status).toBe(403);
    });

    it('cannot promote another admin to its own level or above', async () => {
      const admin = await addMemberAndLogin(app, ctx, 'ADMIN');
      const peer = await addMemberAndLogin(app, ctx, 'ADMIN');

      const response = await authed(app, admin.token)
        .patch(`${base()}/members/${peer.userId}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ROLE_ESCALATION_BLOCKED');
    });
  });

  describe('OWNER', () => {
    it('can change a member role and remove a member', async () => {
      const member = await addMemberAndLogin(app, ctx, 'READER');

      const promoted = await authed(app, ctx.token)
        .patch(`${base()}/members/${member.userId}`)
        .send({ role: 'EDITOR' });
      expect(promoted.status).toBe(200);
      expect(promoted.body.data.role).toBe('EDITOR');
      expect(promoted.body.data.permissions).toContain('transaction:create');

      const removed = await authed(app, ctx.token).delete(`${base()}/members/${member.userId}`);
      expect(removed.status).toBe(204);

      const after = await authed(app, member.token).get(`${base()}/transactions`);
      expect(after.status).toBe(403);
      expect(after.body.error.code).toBe('ORG_ACCESS_DENIED');
    });

    it('cannot remove itself or drop the last owner', async () => {
      const selfRemoval = await authed(app, ctx.token).delete(`${base()}/members/${ctx.userId}`);
      expect(selfRemoval.status).toBe(403);
      expect(selfRemoval.body.error.code).toBe('SELF_REMOVAL_BLOCKED');

      const selfDemotion = await authed(app, ctx.token)
        .patch(`${base()}/members/${ctx.userId}`)
        .send({ role: 'ADMIN' });
      expect(selfDemotion.status).toBe(403);
    });

    it('lets a member leave but stops the last owner from leaving', async () => {
      const member = await addMemberAndLogin(app, ctx, 'READER');

      const left = await authed(app, member.token).delete(`${base()}/membership`);
      expect(left.status).toBe(204);
      expect((await authed(app, member.token).get(`${base()}/accounts`)).status).toBe(403);

      const soleOwner = await authed(app, ctx.token).delete(`${base()}/membership`);
      expect(soleOwner.status).toBe(422);
      expect(soleOwner.body.error.code).toBe('LAST_OWNER_PROTECTED');

      const successor = await addMemberAndLogin(app, ctx, 'ADMIN');
      await authed(app, ctx.token)
        .patch(`${base()}/members/${successor.userId}`)
        .send({ role: 'OWNER' });

      const handedOver = await authed(app, ctx.token).delete(`${base()}/membership`);
      expect(handedOver.status).toBe(204);
    });

    it('404s when changing a role for a non-member', async () => {
      const stranger = await registerOwner(app);
      const response = await authed(app, ctx.token)
        .patch(`${base()}/members/${stranger.userId}`)
        .send({ role: 'READER' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('MEMBER_NOT_FOUND');
    });

    it('rejects adding the same user twice', async () => {
      const email = uniqueEmail('twice');
      await authed(app, ctx.token).post(`${base()}/members`).send({ email, role: 'READER' });
      const second = await authed(app, ctx.token)
        .post(`${base()}/members`)
        .send({ email, role: 'EDITOR' });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ALREADY_A_MEMBER');
    });
  });

  describe('tenant isolation', () => {
    it('blocks a member of one organization from reading another', async () => {
      const outsider = await registerOwner(app);

      for (const url of [
        `${base()}`,
        `${base()}/accounts`,
        `${base()}/transactions`,
        `${base()}/transfers`,
        `${base()}/members`,
        `${base()}/analytics/overview`,
      ]) {
        const response = await authed(app, outsider.token).get(url);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('ORG_ACCESS_DENIED');
      }
    });

    it('404s for an organization that does not exist', async () => {
      const response = await authed(app, ctx.token).get('/api/v1/organizations/org_missing');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('requires authentication on every organization route', async () => {
      const response = await authed(app, 'garbage-token').get(`${base()}/accounts`);
      expect(response.status).toBe(401);
    });

    it('gives a user independent roles in different organizations', async () => {
      const second = await authed(app, ctx.token)
        .post('/api/v1/organizations')
        .send({ name: 'Second Workspace' });
      const member = await addMemberAndLogin(app, ctx, 'READER');

      await authed(app, ctx.token)
        .post(`/api/v1/organizations/${second.body.data.id}/members`)
        .send({ email: member.email, role: 'EDITOR' });

      const me = await authed(app, member.token).get('/api/v1/auth/me');
      const roles = me.body.data.organizations.map((org: { role: string }) => org.role).sort();
      expect(roles).toEqual(['EDITOR', 'READER']);
    });
  });
});
