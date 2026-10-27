# Assumptions & decisions

Everything the brief left open, what was chosen, and why. Where a decision has a cost,
the cost is stated.

---

## 1. Tenancy: accounts belong to an organization

**The brief** asks for accounts, transactions and "authorization", but never says who
owns an account.

**Decision.** Every account, transaction, transfer and audit row carries an `org_id`, and
users join organizations through a `memberships` row that holds their role. A user can
belong to several organizations with a *different* role in each.

**Why.** Without a tenant boundary, "authorization" would only be a label on a user and
could not be tested meaningfully. With it, the interesting failure modes are real: a
non-member is refused, and an account id from another tenant reads as
`404 ACCOUNT_NOT_FOUND` rather than leaking its existence.

**Cost.** Every route is nested under `/organizations/:orgId`, which makes URLs longer
than a single-tenant design would need.

---

## 2. Money is an integer number of minor units

**Decision.** Amounts are parsed once into integer paise/cents (`amount_minor`) and all
arithmetic is integer arithmetic. The API accepts a JSON number or a decimal string with
at most two decimal places, and returns both `amount` (decimal) and `amount_minor`.

**Why.** Floating point cannot represent `0.1` exactly; a ledger that adds floats drifts.
A test posts thirty `0.10` credits and asserts the balance is exactly `3.00` — that test
fails on a float implementation.

**Cost.** Currencies with zero or three decimal places (JPY, KWD) would need the scale to
become a per-currency property. Today the scale is fixed at 2 and documented.

---

## 3. `reference_id` is unique per account, and doubles as an idempotency key

**Decision.** `UNIQUE (account_id, reference_id)`. A repeat on the same account returns
`409 DUPLICATE_REFERENCE_ID` with the id of the entry that already exists. The same
reference on a *different* account is allowed.

**Why.** The brief says "duplicate reference_id for the same account must be handled
correctly", which implies the scope is the account. It also matches reality: one invoice
reference can legitimately touch two accounts (that is exactly what a transfer does — both
legs share the reference). Returning the existing id lets a client that retried after a
timeout reconcile without creating a second entry.

**Cost.** A client wanting a globally unique reference must enforce that itself.

---

## 4. Debits may not overdraw; there is no overdraft

**Decision.** A debit larger than the available balance is rejected with
`422 INSUFFICIENT_BALANCE`, carrying `available_balance`, `requested_amount` and
`shortfall`. `CHECK (balance_minor >= 0)` on the table is the second line of defence.

**Why.** The brief states debits must have sufficient balance. `422` rather than `400`
because the request is well-formed — it is the *state of the world* that refuses it.

**Cost.** Credit facilities, holds and reservations are not modelled.

---

## 5. Corrections are compensating entries

**Decision.** There is no edit and no delete. A mistake is corrected by posting the
opposite entry, which leaves both the error and the correction visible.

**Why.** It is the requirement, and it is also how real ledgers work: the history is the
asset. The API says so in the `405` message rather than returning a bare `404`, so a
client is told *why* instead of guessing that the route was wrong.

---

## 6. An "opening balance" is a credit transaction

**Decision.** `POST /accounts` accepts an optional `opening_balance`. It is not written
into the balance column directly — it is posted as a credit entry with reference
`OPENING-<account code>`.

**Why.** It keeps the invariant *balance = sum of entries* true for every account at every
moment, which is what `GET …/ledger/integrity` verifies. A seeded balance with no entry
behind it would be the one row that invariant could not explain.

---

## 7. Accounts have a status

**Decision.** `active` → `frozen` → `closed`. Frozen and closed accounts reject new
entries with `422 ACCOUNT_NOT_ACTIVE`; closing requires a zero balance
(`422 ACCOUNT_NOT_EMPTY`). Accounts are never deleted.

**Why.** Deleting an account would orphan or destroy history. Freezing is what an
operations team actually needs during an investigation.

---

## 8. Five roles, enforced as permissions

**Decision.** `OWNER`, `ADMIN`, `EDITOR`, `AUDITOR`, `READER`. Routes declare a
*permission* (`transaction:create`), not a role, and roles map to permission sets in one
file (`src/rbac/permissions.ts`). `AUDITOR` exists because "can read the audit trail" and
"can move money" are genuinely different jobs — the brief's "etc." invited the split.

Extra rules beyond the matrix, each of which has a test:

- An ADMIN cannot grant, modify or remove an OWNER.
- Nobody can assign a role above their own.
- Nobody can change their own role.
- The last OWNER cannot leave (`422 LAST_OWNER_PROTECTED`); hand over first.

**Why.** A permission-keyed matrix means adding a role is a data change, not a hunt
through route handlers for `if (role === …)`.

---

## 9. Adding a member can create the user, with a one-time password

**Decision.** `POST /members` with an unknown email creates the user and returns
`temporary_password` **once** in the response.

**Why.** It makes the whole RBAC flow demonstrable without an email provider: add an
EDITOR, sign in as them, watch the API refuse what they may not do. A production build
would send an invitation link and never put a password in a response body.

---

## 10. JWT access tokens only

**Decision.** HS256 access token, 12-hour lifetime, no refresh token, no server-side
session store. Passwords are bcrypt hashed (10 rounds). Login answers identically for an
unknown email and a wrong password.

**Why.** Proportionate to an assignment. The gap is explicit rather than hidden: without
a session store, a token cannot be revoked before it expires — refresh-token rotation
plus a revocation list is the first thing to add for production.

---

## 11. SQLite is the datastore

**Decision.** SQLite via `better-sqlite3`, WAL journal mode, `foreign_keys = ON`, and
`BEGIN IMMEDIATE` for every write unit.

**Why.** The brief allows any database. SQLite makes the submission runnable with
`npm install` and no services, while still providing exactly the primitives the integrity
requirements need: real transactions, `CHECK` and `UNIQUE` constraints, and triggers for
immutability. `better-sqlite3` is synchronous, which removes a whole class of
interleaving bugs — a transaction cannot be accidentally interrupted by an `await`.

**Cost.** One writer at a time. Under write contention a second writer gets
`SQLITE_BUSY`, which the API surfaces as `503 LEDGER_BUSY` after a 5-second busy timeout.
For horizontal scale this would move to Postgres; the repository functions and
`withTransaction()` are the only files that would change.

---

## 12. Timestamps are UTC

**Decision.** Everything is stored and returned as ISO-8601 UTC. Analytics group by UTC
day, and every chart says so in its subtitle.

**Why.** A ledger spanning timezones needs one truth. Day-boundary ambiguity is a
reporting bug waiting to happen; stating the timezone in the UI is cheaper than guessing
the viewer's.

---

## 13. Pagination caps at 100 rows

**Decision.** `page` ≥ 1, `limit` between 1 and 100 (default 20). Anything else is
`400 INVALID_PAGINATION` naming the offending parameter. A page past the end returns an
empty array with valid metadata, not an error.

**Why.** An unbounded `limit` is a denial-of-service vector. An empty last page is a
normal result for a client that is paging while new rows arrive.

---

## 14. Sorting is `created_at DESC, id DESC`

**Decision.** Ids are monotonic ULIDs, so their lexicographic order matches creation
order and they break ties within the same millisecond.

**Why.** Sorting on a timestamp alone is unstable: two rows sharing a millisecond can swap
between queries, which makes a row appear twice or vanish while paging. A test walks every
page and asserts no duplicates and no omissions.

---

## 15. The UI mirrors permissions but never enforces them

**Decision.** The console hides navigation, buttons and routes the current role cannot
use, and shows a plain "your role cannot open this screen" panel if a URL is typed
directly. Every guard also exists on the server.

**Why.** Client-side checks are a usability feature, not a security boundary. The RBAC
tests call the API directly, with no browser involved, so they prove the real boundary.

---

## 16. Analytics are computed on read

**Decision.** The dashboard's eight endpoints aggregate with SQL at request time; there is
no materialised reporting table.

**Why.** At this data size (hundreds of thousands of rows) indexed aggregates are fast,
and a derived table is one more thing that can disagree with the ledger. If the volume
grew, the fix is a nightly rollup table — the endpoints would keep their shape.

---

## 17. What is deliberately out of scope

- **Double-entry bookkeeping.** This is a single-entry ledger per account, with transfers
  writing two linked entries. A general ledger with balanced journal entries, chart of
  accounts and periods is a different, larger product.
- **Soft deletes / archival.** Nothing is deleted, so nothing needs undeleting.
- **File attachments, approval workflows, scheduled transfers.** Not in the brief.
- **i18n.** The console is English with `en-IN` number and currency formatting.
