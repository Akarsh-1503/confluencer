/**
 * Organization level RBAC.
 *
 * A user's capabilities come from exactly one membership row per organization, so a
 * permission check is a table lookup: role -> permission set. Roles are ranked so that
 * "an ADMIN may not touch an OWNER" style rules can be expressed without special cases.
 */
export const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 50,
  ADMIN: 40,
  EDITOR: 30,
  AUDITOR: 20,
  READER: 10,
};

export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'member:read',
  'member:manage',
  'account:read',
  'account:create',
  'account:update',
  'transaction:read',
  'transaction:create',
  'transfer:read',
  'transfer:create',
  'analytics:read',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READER_PERMISSIONS: Permission[] = [
  'org:read',
  'member:read',
  'account:read',
  'transaction:read',
  'transfer:read',
  'analytics:read',
];

const AUDITOR_PERMISSIONS: Permission[] = [...READER_PERMISSIONS, 'audit:read'];

const EDITOR_PERMISSIONS: Permission[] = [
  ...READER_PERMISSIONS,
  'account:create',
  'transaction:create',
  'transfer:create',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...EDITOR_PERMISSIONS,
  'org:update',
  'member:manage',
  'account:update',
  'audit:read',
];

const OWNER_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS, 'org:delete'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  EDITOR: new Set(EDITOR_PERMISSIONS),
  AUDITOR: new Set(AUDITOR_PERMISSIONS),
  READER: new Set(READER_PERMISSIONS),
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort();
}

/** True when `actor` outranks `target`; used to stop an ADMIN from demoting an OWNER. */
export function outranks(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/** Every role, with its permissions, for the UI permission matrix screen. */
export function roleMatrix() {
  return ROLES.map((role) => ({
    role,
    rank: ROLE_RANK[role],
    permissions: permissionsForRole(role),
  }));
}
