import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import {
  findMembership,
  findOrganizationById,
} from '../modules/organizations/organizations.repository.js';
import {
  type Permission,
  type Role,
  outranks,
  permissionsForRole,
  roleHasPermission,
} from '../rbac/permissions.js';

/**
 * Resolves `:orgId` into a tenant context. Everything downstream reads the organization
 * id from here rather than from the URL, which is what keeps one tenant's query from
 * ever touching another tenant's rows.
 */
export function resolveOrgContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(AppError.unauthorized());
    return;
  }

  const orgId = req.params.orgId;
  if (!orgId) {
    next(AppError.validation('Organization id is required in the path'));
    return;
  }

  const organization = findOrganizationById(orgId);
  if (!organization) {
    next(AppError.notFound('ORGANIZATION_NOT_FOUND', `No organization exists with id "${orgId}"`));
    return;
  }

  const membership = findMembership(organization.id, req.auth.userId);
  if (!membership) {
    next(
      AppError.forbidden(
        'ORG_ACCESS_DENIED',
        'You are not a member of this organization',
      ),
    );
    return;
  }

  req.org = {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    currency: organization.currency,
    membershipId: membership.id,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
  next();
}

/** Guards a route behind one permission from the role matrix. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.org) {
      next(AppError.internal('Organization context middleware must run before requirePermission'));
      return;
    }
    if (!roleHasPermission(req.org.role, permission)) {
      next(
        AppError.forbidden(
          'INSUFFICIENT_ROLE',
          `Your role (${req.org.role}) is not allowed to perform this action`,
          [{ message: `Requires permission "${permission}"`, required_permission: permission, role: req.org.role }],
        ),
      );
      return;
    }
    next();
  };
}

export function orgContext(req: Request) {
  if (!req.org) throw AppError.internal('Organization context is missing');
  return req.org;
}

/** An ADMIN may manage EDITOR/READER/AUDITOR rows but never an OWNER row. */
export function assertCanManageRole(actorRole: Role, targetRole: Role): void {
  if (actorRole === 'OWNER') return;
  if (!outranks(actorRole, targetRole)) {
    throw AppError.forbidden(
      'ROLE_ESCALATION_BLOCKED',
      `A ${actorRole} cannot manage a member whose role is ${targetRole}`,
    );
  }
}

/** Nobody can grant a role above their own. */
export function assertCanAssignRole(actorRole: Role, nextRole: Role): void {
  if (actorRole === 'OWNER') return;
  if (!outranks(actorRole, nextRole)) {
    throw AppError.forbidden(
      'ROLE_ESCALATION_BLOCKED',
      `A ${actorRole} cannot assign the ${nextRole} role`,
    );
  }
}
