import type { Db } from '../../db/index.js';
import { getDb } from '../../db/index.js';
import type { UserRow } from '../../db/types.js';
import { newUserId } from '../../utils/id.js';

export function findUserByEmail(email: string, db: Db = getDb()): UserRow | undefined {
  return db
    .prepare<[string], UserRow>('SELECT * FROM users WHERE email_lower = ?')
    .get(email.trim().toLowerCase());
}

export function findUserById(id: string, db: Db = getDb()): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
}

export function insertUser(
  input: { email: string; name: string; passwordHash: string },
  db: Db = getDb(),
): UserRow {
  const now = new Date().toISOString();
  const row: UserRow = {
    id: newUserId(),
    email: input.email.trim(),
    email_lower: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    password_hash: input.passwordHash,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO users (id, email, email_lower, name, password_hash, created_at, updated_at)
     VALUES (@id, @email, @email_lower, @name, @password_hash, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    created_at: row.created_at,
  };
}
