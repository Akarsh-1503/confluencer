import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../../db/index.js';
import type { AuditLogRow } from '../../db/types.js';
import { getDb } from '../../db/index.js';
import { AppError } from '../../errors/AppError.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import {
  assertCanAssignRole,
  assertCanManageRole,
  orgContext,
  requirePermission,
  resolveOrgContext,
} from '../../middleware/orgContext.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { permissionsForRole } from '../../rbac/permissions.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { toMajorUnits } from '../../utils/money.js';
import { buildPageMeta, parsePagination } from '../../utils/pagination.js';
import { recordAudit, serializeAuditLog } from '../audit/audit.service.js';
import {
  currencySchema,
  emailSchema,
  orgIdParams,
  requiredString,
  roleSchema,
} from '../common/schemas.js';
import { findUserByEmail, insertUser } from '../auth/users.repository.js';
import {
  countOwners,
  deleteMembership,
  findMembership,
  insertMembership,
  insertOrganization,
  listMembershipsWithUsers,
  listOrganizationsForUser,
  serializeMembership,
  serializeOrganization,
  updateMembershipRole,
  updateOrganizationName,
} from './organizations.repository.js';

const createOrgSchema = z.object({
  name: requiredString('name', 120),
  currency: currencySchema.optional(),
});

const updateOrgSchema = z.object({
  name: requiredString('name', 120),
});

const addMemberSchema = z.object({
  email: emailSchema,
  role: roleSchema,
  name: requiredString('name', 120).optional(),
});

const updateMemberSchema = z.object({
  role: roleSchema,
});

const memberParams = orgIdParams.extend({
  userId: requiredString('userId', 64),
});

export const organizationsRouter = Router();

organizationsRouter.use(authenticate);

/** Every organization the caller belongs to, with dashboard headline numbers. */
organizationsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = currentUser(req);
    const organizations = listOrganizationsForUser(auth.userId);
    res.json({
      data: organizations.map((org) => ({
        ...serializeOrganization(org),
        role: org.role,
        permissions: permissionsForRole(org.role),
        account_count: org.account_count,
        member_count: org.member_count,
        transaction_count: org.transaction_count,
        total_balance: toMajorUnits(org.total_balance_minor),
      })),
    });
  }),
);

organizationsRouter.post(
  '/',
  validateBody(createOrgSchema),
  asyncHandler((req, res) => {
    const auth = currentUser(req);
    const body = req.body as z.infer<typeof createOrgSchema>;

    const result = withTransaction((db) => {
      const organization = insertOrganization(
        { name: body.name, currency: body.currency ?? 'INR', createdBy: auth.userId },
        db,
      );
      const membership = insertMembership(
        { orgId: organization.id, userId: auth.userId, role: 'OWNER' },
        db,
      );
      return { organization, membership };
    });

    recordAudit(req, {
      orgId: result.organization.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: result.organization.id,
      metadata: { name: result.organization.name },
    });

    res.status(201).json({
      data: {
        ...serializeOrganization(result.organization),
        role: result.membership.role,
        permissions: permissionsForRole(result.membership.role),
      },
    });
  }),
);

organizationsRouter.get(
  '/:orgId',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('org:read'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const summary = listOrganizationsForUser(auth.userId).find((row) => row.id === org.id);
    res.json({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        currency: org.currency,
        role: org.role,
        permissions: org.permissions,
        account_count: summary?.account_count ?? 0,
        member_count: summary?.member_count ?? 0,
        transaction_count: summary?.transaction_count ?? 0,
        total_balance: toMajorUnits(summary?.total_balance_minor ?? 0),
      },
    });
  }),
);

organizationsRouter.patch(
  '/:orgId',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('org:update'),
  validateBody(updateOrgSchema),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const body = req.body as z.infer<typeof updateOrgSchema>;
    const updated = updateOrganizationName(org.id, body.name);
    if (!updated) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organization no longer exists');

    recordAudit(req, {
      action: 'organization.updated',
      entityType: 'organization',
      entityId: org.id,
      metadata: { name: body.name },
    });

    res.json({ data: { ...serializeOrganization(updated), role: org.role } });
  }),
);

organizationsRouter.get(
  '/:orgId/members',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('member:read'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const members = listMembershipsWithUsers(org.id);
    res.json({
      data: members.map((member) => ({
        ...serializeMembership(member),
        permissions: permissionsForRole(member.role),
      })),
      meta: { total_records: members.length },
    });
  }),
);

/**
 * Adds a member. If the email has no account yet, one is created with a temporary
 * password that is returned exactly once — enough to demo the full RBAC flow without an
 * email delivery dependency.
 */
organizationsRouter.post(
  '/:orgId/members',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('member:manage'),
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const body = req.body as z.infer<typeof addMemberSchema>;

    assertCanAssignRole(org.role, body.role);

    const existingUser = findUserByEmail(body.email);
    let temporaryPassword: string | undefined;
    let passwordHash: string | undefined;

    if (!existingUser) {
      temporaryPassword = `Cnf-${randomBytes(6).toString('base64url')}`;
      passwordHash = await bcrypt.hash(temporaryPassword, 10);
    } else if (findMembership(org.id, existingUser.id)) {
      throw AppError.conflict(
        'ALREADY_A_MEMBER',
        `${body.email} is already a member of this organization`,
      );
    }

    const result = withTransaction((db) => {
      const user =
        existingUser ??
        insertUser(
          {
            email: body.email,
            name: body.name ?? body.email.split('@')[0] ?? 'Member',
            passwordHash: passwordHash as string,
          },
          db,
        );
      const membership = insertMembership(
        { orgId: org.id, userId: user.id, role: body.role, invitedBy: auth.userId },
        db,
      );
      return { user, membership };
    });

    recordAudit(req, {
      action: 'member.added',
      entityType: 'membership',
      entityId: result.membership.id,
      metadata: { email: body.email, role: body.role, created_user: !existingUser },
    });

    res.status(201).json({
      data: {
        id: result.membership.id,
        organization_id: org.id,
        role: result.membership.role,
        permissions: permissionsForRole(result.membership.role),
        created_at: result.membership.created_at,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
        },
        ...(temporaryPassword ? { temporary_password: temporaryPassword } : {}),
      },
    });
  }),
);

organizationsRouter.patch(
  '/:orgId/members/:userId',
  validateParams(memberParams),
  resolveOrgContext,
  requirePermission('member:manage'),
  validateBody(updateMemberSchema),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const { userId } = req.params as z.infer<typeof memberParams>;
    const body = req.body as z.infer<typeof updateMemberSchema>;

    const membership = findMembership(org.id, userId);
    if (!membership) {
      throw AppError.notFound('MEMBER_NOT_FOUND', 'This user is not a member of the organization');
    }

    assertCanManageRole(org.role, membership.role);
    assertCanAssignRole(org.role, body.role);

    // Self-service checks come first so the caller is told what they actually did wrong.
    if (membership.user_id === auth.userId && body.role !== membership.role) {
      throw AppError.forbidden('SELF_ROLE_CHANGE_BLOCKED', 'You cannot change your own role');
    }
    if (membership.role === 'OWNER' && body.role !== 'OWNER' && countOwners(org.id) === 1) {
      throw AppError.unprocessable(
        'LAST_OWNER_PROTECTED',
        'An organization must always keep at least one OWNER',
      );
    }

    updateMembershipRole(membership.id, body.role);
    recordAudit(req, {
      action: 'member.role_changed',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { from: membership.role, to: body.role, user_id: userId },
    });

    const updated = listMembershipsWithUsers(org.id).find((row) => row.user_id === userId);
    res.json({
      data: updated
        ? { ...serializeMembership(updated), permissions: permissionsForRole(updated.role) }
        : null,
    });
  }),
);

organizationsRouter.delete(
  '/:orgId/members/:userId',
  validateParams(memberParams),
  resolveOrgContext,
  requirePermission('member:manage'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const { userId } = req.params as z.infer<typeof memberParams>;

    const membership = findMembership(org.id, userId);
    if (!membership) {
      throw AppError.notFound('MEMBER_NOT_FOUND', 'This user is not a member of the organization');
    }
    assertCanManageRole(org.role, membership.role);

    if (membership.user_id === auth.userId) {
      throw AppError.forbidden(
        'SELF_REMOVAL_BLOCKED',
        'You cannot remove your own membership; ask another owner or admin',
      );
    }
    if (membership.role === 'OWNER' && countOwners(org.id) === 1) {
      throw AppError.unprocessable(
        'LAST_OWNER_PROTECTED',
        'An organization must always keep at least one OWNER',
      );
    }

    deleteMembership(membership.id);
    recordAudit(req, {
      action: 'member.removed',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { user_id: userId, role: membership.role },
    });

    res.status(204).send();
  }),
);

/**
 * Leave the organization. Any member can do this for themselves — it needs no
 * member:manage permission — but the last OWNER is blocked so an organization can never
 * end up with nobody able to administer it.
 */
organizationsRouter.delete(
  '/:orgId/membership',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('org:read'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);

    const membership = findMembership(org.id, auth.userId);
    if (!membership) {
      throw AppError.notFound('MEMBER_NOT_FOUND', 'You are not a member of this organization');
    }
    if (membership.role === 'OWNER' && countOwners(org.id) === 1) {
      throw AppError.unprocessable(
        'LAST_OWNER_PROTECTED',
        'Promote another member to OWNER before leaving this organization',
      );
    }

    recordAudit(req, {
      action: 'member.left',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { role: membership.role },
    });
    deleteMembership(membership.id);

    res.status(204).send();
  }),
);

/** Append-only activity trail. Visible to OWNER, ADMIN and AUDITOR. */
organizationsRouter.get(
  '/:orgId/audit-logs',
  validateParams(orgIdParams),
  resolveOrgContext,
  requirePermission('audit:read'),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const page = parsePagination(req.query as Record<string, unknown>);
    const db = getDb();

    const total =
      db
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM audit_logs WHERE org_id = ?',
        )
        .get(org.id)?.count ?? 0;

    const rows = db
      .prepare<[string, number, number], AuditLogRow>(
        `SELECT * FROM audit_logs
          WHERE org_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(org.id, page.limit, page.offset);

    res.json({
      data: rows.map(serializeAuditLog),
      meta: { pagination: buildPageMeta(page, total) },
    });
  }),
);

