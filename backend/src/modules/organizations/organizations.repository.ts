import type { Db } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import type { MembershipRow, OrganizationRow } from '../../db/types.js';
import type { Role } from '../../rbac/permissions.js';
import { newMembershipId, newOrgId, slugify } from '../../utils/id.js';

export function findOrganizationById(id: string, db: Db = getDb()): OrganizationRow | undefined {
  return db.prepare<[string], OrganizationRow>('SELECT * FROM organizations WHERE id = ?').get(id);
}

/** Appends -2, -3 … until the slug is free, so two "Acme" orgs can coexist. */
export function uniqueSlug(name: string, db: Db = getDb()): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  const exists = db.prepare<[string], { id: string }>('SELECT id FROM organizations WHERE slug = ?');
  while (exists.get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function insertOrganization(
  input: { name: string; currency?: string; createdBy: string },
  db: Db = getDb(),
): OrganizationRow {
  const now = new Date().toISOString();
  const row: OrganizationRow = {
    id: newOrgId(),
    name: input.name.trim(),
    slug: uniqueSlug(input.name, db),
    currency: (input.currency ?? 'INR').toUpperCase(),
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO organizations (id, name, slug, currency, created_by, created_at, updated_at)
     VALUES (@id, @name, @slug, @currency, @created_by, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function updateOrganizationName(
  orgId: string,
  name: string,
  db: Db = getDb(),
): OrganizationRow | undefined {
  db.prepare('UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?').run(
    name.trim(),
    new Date().toISOString(),
    orgId,
  );
  return findOrganizationById(orgId, db);
}

export function insertMembership(
  input: { orgId: string; userId: string; role: Role; invitedBy?: string | null },
  db: Db = getDb(),
): MembershipRow {
  const now = new Date().toISOString();
  const row: MembershipRow = {
    id: newMembershipId(),
    org_id: input.orgId,
    user_id: input.userId,
    role: input.role,
    invited_by: input.invitedBy ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO memberships (id, org_id, user_id, role, invited_by, created_at, updated_at)
     VALUES (@id, @org_id, @user_id, @role, @invited_by, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function findMembership(
  orgId: string,
  userId: string,
  db: Db = getDb(),
): MembershipRow | undefined {
  return db
    .prepare<[string, string], MembershipRow>(
      'SELECT * FROM memberships WHERE org_id = ? AND user_id = ?',
    )
    .get(orgId, userId);
}

export type MembershipWithUser = MembershipRow & {
  user_name: string;
  user_email: string;
};

export function listMembershipsWithUsers(orgId: string, db: Db = getDb()): MembershipWithUser[] {
  return db
    .prepare<[string], MembershipWithUser>(
      `SELECT m.*, u.name AS user_name, u.email AS user_email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ?
        ORDER BY CASE m.role
                   WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'EDITOR' THEN 2
                   WHEN 'AUDITOR' THEN 3 ELSE 4 END,
                 u.name COLLATE NOCASE ASC`,
    )
    .all(orgId);
}

export function countOwners(orgId: string, db: Db = getDb()): number {
  const row = db
    .prepare<[string], { count: number }>(
      "SELECT COUNT(*) AS count FROM memberships WHERE org_id = ? AND role = 'OWNER'",
    )
    .get(orgId);
  return row?.count ?? 0;
}

export function updateMembershipRole(
  membershipId: string,
  role: Role,
  db: Db = getDb(),
): void {
  db.prepare('UPDATE memberships SET role = ?, updated_at = ? WHERE id = ?').run(
    role,
    new Date().toISOString(),
    membershipId,
  );
}

export function deleteMembership(membershipId: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM memberships WHERE id = ?').run(membershipId);
}

export type OrganizationSummaryRow = OrganizationRow & {
  role: Role;
  membership_id: string;
  account_count: number;
  transaction_count: number;
  total_balance_minor: number;
  member_count: number;
};

/** Organizations the user belongs to, with the headline numbers the UI switcher shows. */
export function listOrganizationsForUser(
  userId: string,
  db: Db = getDb(),
): OrganizationSummaryRow[] {
  return db
    .prepare<[string], OrganizationSummaryRow>(
      `SELECT o.*,
              m.role,
              m.id AS membership_id,
              (SELECT COUNT(*) FROM accounts a WHERE a.org_id = o.id)                AS account_count,
              (SELECT COUNT(*) FROM transactions t WHERE t.org_id = o.id)            AS transaction_count,
              (SELECT COALESCE(SUM(a.balance_minor), 0) FROM accounts a WHERE a.org_id = o.id)
                                                                                     AS total_balance_minor,
              (SELECT COUNT(*) FROM memberships mm WHERE mm.org_id = o.id)           AS member_count
         FROM organizations o
         JOIN memberships m ON m.org_id = o.id
        WHERE m.user_id = ?
        ORDER BY o.created_at ASC`,
    )
    .all(userId);
}

export function serializeOrganization(row: OrganizationRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeMembership(row: MembershipWithUser) {
  return {
    id: row.id,
    organization_id: row.org_id,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
    },
  };
}
