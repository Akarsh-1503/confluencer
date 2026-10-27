-- Confluencr Ledger — SQLite schema
--
-- Integrity rules that the API relies on are expressed here as constraints so the
-- database refuses bad data even if application code is bypassed:
--   * money is an INTEGER count of minor units, never a float
--   * balances can never go negative          (CHECK on accounts.balance_minor)
--   * transaction amounts are always positive (CHECK on transactions.amount_minor)
--   * (account_id, reference_id) is unique    (duplicate reference protection)
--   * transactions can never be updated or deleted (BEFORE triggers below)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  email_lower   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug        TEXT NOT NULL UNIQUE,
  currency    TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3),
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER')),
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (org_id, role);

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  holder_email  TEXT,
  currency      TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_accounts_org_created ON accounts (org_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS transfers (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL DEFAULT 'INR',
  reference_id    TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL,
  UNIQUE (org_id, reference_id),
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_org_created ON transfers (org_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type                    TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount_minor            INTEGER NOT NULL CHECK (amount_minor > 0),
  balance_after_minor     INTEGER NOT NULL CHECK (balance_after_minor >= 0),
  description             TEXT,
  reference_id            TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  transfer_id             TEXT REFERENCES transfers(id) ON DELETE RESTRICT,
  counterparty_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  created_by              TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at              TEXT NOT NULL,
  UNIQUE (account_id, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_org_created ON transactions (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_created ON transactions (account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (org_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions (transfer_id);

-- Immutability, enforced by the database and not only by the absence of routes.
CREATE TRIGGER IF NOT EXISTS trg_transactions_immutable_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_IMMUTABLE: transactions cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_immutable_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_IMMUTABLE: transactions cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT,
  actor_role    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  metadata      TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs (org_id, created_at DESC, id DESC);

-- Convenience view: the balance implied by the transaction log, used by the
-- /ledger/integrity endpoint to prove stored balances match their history.
CREATE VIEW IF NOT EXISTS account_derived_balances AS
SELECT
  a.id   AS account_id,
  a.org_id,
  a.balance_minor AS stored_balance_minor,
  COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_minor ELSE -t.amount_minor END), 0)
         AS derived_balance_minor,
  COUNT(t.id) AS transaction_count
FROM accounts a
LEFT JOIN transactions t ON t.account_id = a.id
GROUP BY a.id;
