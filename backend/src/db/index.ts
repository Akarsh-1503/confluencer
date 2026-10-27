import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

export type Db = Database.Database;

const here = path.dirname(fileURLToPath(import.meta.url));

let instance: Db | null = null;

function schemaSql(): string {
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(here, '..', '..', 'src', 'db', 'schema.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  }
  throw new Error(`Unable to locate schema.sql. Looked in: ${candidates.join(', ')}`);
}

function applyPragmas(db: Db, databasePath: string): void {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') {
    // WAL keeps readers (dashboard polling) from blocking ledger writes.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
}

export function openDatabase(databasePath: string = env.databasePath): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  applyPragmas(db, databasePath);
  db.exec(schemaSql());
  return db;
}

export function getDb(): Db {
  if (!instance) instance = openDatabase();
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/** Test helper: point the singleton at a throwaway in-memory database. */
export function useDatabase(db: Db): void {
  instance = db;
}

/**
 * Runs `work` inside a single SQLite transaction. better-sqlite3 is synchronous, so the
 * whole unit of work either commits or rolls back with no interleaving — this is what
 * makes "insert transaction + update balance" one atomic operation.
 *
 * IMMEDIATE takes the write lock up front, so a concurrent writer fails fast with
 * SQLITE_BUSY instead of deadlocking halfway through.
 */
export function withTransaction<T>(work: (db: Db) => T): T {
  const db = getDb();
  const runner = db.transaction(work);
  return runner.immediate(db);
}
