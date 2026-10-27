# Design notes

How the pieces fit together: the data model, the integrity strategy, the layering, and
the rules the dashboard's charts follow.

---

## 1. Data model

```
users ──────┐
            │  memberships (role)            organizations
            └──────────────┬──────────────────────┬────────
                           │                      │
                           │                      ├── accounts ──┬── transactions
                           │                      │              │   (immutable)
                           │                      ├── transfers ─┘
                           └──────────────────────┴── audit_logs
```

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Identity | `UNIQUE(email_lower)` |
| `organizations` | Tenant | `UNIQUE(slug)` |
| `memberships` | Role of a user inside one tenant | `UNIQUE(org_id, user_id)`, `CHECK role IN (…)` |
| `accounts` | A balance | `UNIQUE(org_id, name)`, `UNIQUE(code)`, `CHECK(balance_minor >= 0)`, `CHECK status IN (…)` |
| `transactions` | Ledger entry | `UNIQUE(account_id, reference_id)`, `CHECK(amount_minor > 0)`, `CHECK(balance_after_minor >= 0)`, immutability triggers |
| `transfers` | Header linking two legs | `UNIQUE(org_id, reference_id)`, `CHECK(from <> to)` |
| `audit_logs` | Append-only activity | indexed by `(org_id, created_at DESC, id DESC)` |
| `account_derived_balances` | View: stored vs. derived balance per account | backs `/ledger/integrity` |

Identifiers are prefixed monotonic ULIDs (`txn_01J…`): sortable by creation time,
unguessable, and self-describing in logs.

### Why `balance_after_minor` is stored on every entry

The running balance is recomputed on write and stored with the entry. It makes a
statement view a single indexed scan instead of a window function over history, and it
turns reconciliation into a cheap equality check: the latest entry's `balance_after` must
equal the account's stored balance, and the sum of signed amounts must equal it too. Both
are asserted by `/ledger/integrity` and by the test suite.

---

## 2. The integrity strategy, layer by layer

Each guarantee is enforced at more than one level, so no single mistake can break it.

| Guarantee | Application layer | Database layer |
|---|---|---|
| No negative balance | Pre-check → `422 INSUFFICIENT_BALANCE` with the shortfall | `CHECK (balance_minor >= 0)` |
| Positive amounts | Zod + integer money parser | `CHECK (amount_minor > 0)` |
| No duplicate reference | Pre-check → `409` with the existing entry id | `UNIQUE (account_id, reference_id)` |
| Immutable entries | No mutating routes; `405 TRANSACTION_IMMUTABLE` | `BEFORE UPDATE` / `BEFORE DELETE` triggers that `RAISE(ABORT)` |
| Atomicity | `withTransaction()` wraps read → insert → balance update → audit | `BEGIN IMMEDIATE … COMMIT` |
| Tenant isolation | `resolveOrgContext` puts `org_id` in the request; repositories always filter on it | Foreign keys to `organizations` |

The error handler translates a database constraint violation back into the same error
code the service would have produced, so a client sees one vocabulary regardless of which
layer caught the problem.

### The write path, in full

```ts
withTransaction((db) => {
  const account = requireAccount(orgId, accountId, db);   // 404 / 422 if frozen
  assertNoDuplicateReference(account.id, referenceId, db); // 409
  if (type === 'debit') assertSufficientBalance(account, amountMinor); // 422

  const balanceAfter = account.balance_minor + delta;
  const transaction  = insertTransaction({ …, balanceAfterMinor: balanceAfter }, db);
  applyBalanceDelta(account.id, delta, db);

  const updated = findAccount(orgId, account.id, db);
  if (updated.balance_minor !== balanceAfter) throw AppError.internal(…); // forces rollback
  audit?.(db);
  return { transaction, account: updated };
});
```

The re-read and comparison at the end is a self-check: if the stored balance and the entry
ever disagreed, the transaction rolls back rather than persisting an inconsistency. The
atomicity test exploits the `audit?.(db)` hook to inject a late failure and asserts that
both the entry and the balance change disappear.

---

## 3. Backend layering

```
routes  →  validate (zod)  →  controller  →  service        →  repository  →  SQLite
             ↑                                 ↑                   ↑
         schemas/            business rules & transactions     plain SQL,
       common/schemas.ts     (ledger.service.ts)               no business logic
```

- **Routes** declare the permission they need and the schema they accept. Reading a route
  file tells you who may call it and what it takes.
- **Services** own the rules and the transaction boundary. `ledger.service.ts` is the only
  file that may move a balance.
- **Repositories** are thin, typed SQL. Swapping SQLite for Postgres means rewriting this
  layer and nothing above it.
- **`AppError`** is the only error type thrown on purpose; anything else is an
  unexpected 500 and gets logged with the request id.

---

## 4. Frontend structure

```
AuthContext        token in localStorage, /auth/me, organization switching, can(permission)
  └─ AppShell      sidebar + top bar + org switcher + live ledger-integrity indicator
       └─ pages    dashboard · accounts · account detail · transactions · transfers
                   · access control · audit trail
hooks/queries.ts   every endpoint as a typed React Query hook; one invalidation helper
                   refreshes balances, charts and the audit trail after any write
lib/api.ts         fetch wrapper that reproduces the API's error envelope as ApiError,
                   so a form can ask error.fieldError('amount') directly
```

Permission handling is deliberately three-layered: the sidebar hides what you cannot use,
routes render an explanatory panel if you navigate directly, and the API refuses anyway.

---

## 5. Chart and colour rules

The dashboard follows one validated dark palette rather than ad-hoc colours. The rules,
and where each one shows up:

**Colour is assigned by the job it does.**
*Categorical* (identity): credit always takes slot 1 (blue `#3987e5`), debit always slot 2
(orange `#d95926`). Because colour follows the entity rather than its rank, filtering a
chart never repaints the remaining series.
*Sequential* (magnitude): one blue hue, light → dark. Used for the balance-distribution
pie, where slice colour reinforces slice size, and for the activity heat map, where an
empty hour recedes into the surface and a busy hour reads brightest.
*Status* (state): account status uses the reserved status palette and always ships with an
icon **and** a label, never colour alone.

**Never two y-axes.** Daily credit/debit and the cumulative closing balance are different
scales, so they are two charts side by side rather than one dual-axis chart.

**Never a generated ninth hue.** The balance-distribution endpoint folds everything past
the cut-off into a single `Other (n accounts)` slice server-side, so the chart cannot run
out of safe colours.

**Charts that compare every mark against every other mark** — the account bubble map — use
only the three palette slots that stay separable for colour-blind readers in *all* pairs,
and each series also carries a distinct shape (circle / triangle / diamond).

**Every chart has a table view.** The icon in each chart header swaps the figure for the
same numbers as text, which is both the accessibility fallback and the fastest way to
check a value.

**Text wears text tokens.** Values, labels and legends use the ink colours; a small swatch
beside them carries identity. Numbers in columns use tabular figures; hero figures do not.

The palette was validated with the data-viz validator for the dark surface `#1a1a19`:
credit/debit pass every check (worst colour-blind ΔE 26.8), and the three bubble-chart
slots pass on all pairs (worst ΔE 9.4).

---

## 6. Performance notes

- Indexes cover the access patterns the UI actually uses:
  `(org_id, created_at DESC, id DESC)` for the ledger feed,
  `(account_id, created_at DESC, id DESC)` for a statement,
  `(org_id, type)` for the type filter, and `transfer_id` for leg lookup.
- List endpoints run one `COUNT(*)` and one page query; filter totals are a third
  aggregate over the same `WHERE` clause.
- WAL journal mode lets the dashboard's eight read queries run while a write is in
  flight.
- The frontend splits `recharts` into its own bundle chunk (≈116 kB gzipped) so a UI
  change does not invalidate it for returning users.
