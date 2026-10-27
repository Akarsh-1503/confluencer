import { env } from '../config/env.js';
import { closeDb, getDb } from './index.js';

/**
 * The schema is idempotent (CREATE TABLE IF NOT EXISTS everywhere), so "migrating" is
 * just opening the database once and letting schema.sql apply.
 */
const db = getDb();
const tables = db
  .prepare<[], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();

console.log(`[migrate] database : ${env.databasePath}`);
console.log(`[migrate] tables   : ${tables.map((table) => table.name).join(', ')}`);
closeDb();
