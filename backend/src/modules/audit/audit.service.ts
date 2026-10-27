import type { Request } from 'express';
import type { Db } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import type { AuditLogRow } from '../../db/types.js';
import { newAuditId } from '../../utils/id.js';

export type AuditInput = {
  orgId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

function clientIp(req: Request): string | null {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}

/**
 * Appends an audit row. Pass `db` when the caller is already inside a transaction so the
 * audit entry commits or rolls back together with the change it describes.
 */
export function recordAudit(req: Request, input: AuditInput, db: Db = getDb()): void {
  db.prepare(
    `INSERT INTO audit_logs
       (id, org_id, actor_user_id, actor_email, actor_role, action, entity_type, entity_id, metadata, ip_address, created_at)
     VALUES (@id, @org_id, @actor_user_id, @actor_email, @actor_role, @action, @entity_type, @entity_id, @metadata, @ip_address, @created_at)`,
  ).run({
    id: newAuditId(),
    org_id: input.orgId ?? req.org?.id ?? null,
    actor_user_id: req.auth?.userId ?? null,
    actor_email: req.auth?.email ?? null,
    actor_role: req.org?.role ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    ip_address: clientIp(req),
    created_at: new Date().toISOString(),
  });
}

export function serializeAuditLog(row: AuditLogRow) {
  let metadata: unknown = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = row.metadata;
    }
  }
  return {
    id: row.id,
    organization_id: row.org_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    actor: {
      user_id: row.actor_user_id,
      email: row.actor_email,
      role: row.actor_role,
    },
    metadata,
    ip_address: row.ip_address,
    created_at: row.created_at,
  };
}
