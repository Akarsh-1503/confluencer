# Confluencr Ledger — API reference

**Base URL** `http://localhost:4000/api/v1`
**Content type** `application/json`
**Auth** `Authorization: Bearer <jwt>` on everything except `/auth/register`,
`/auth/login`, `/auth/roles` and `/health`.

---

## Conventions

### Success envelope

```jsonc
{
  "data": { },          // or [ ] for collections
  "meta": {             // present on list endpoints
    "pagination": { "page": 1, "limit": 20, "total_records": 595,
                    "total_pages": 30, "has_next_page": true, "has_previous_page": false },
    "sort":    { "field": "created_at", "order": "desc" },
    "totals":  { "credit_count": 325, "debit_count": 270,
                 "total_credit": 69484.86, "total_debit": 42401.01, "net_amount": 27083.85 },
    "filters": { "account_id": null, "type": null, "q": null }
  }
}
```

### Error envelope

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body failed validation",
    "details": [ { "field": "amount", "message": "Amount must be greater than 0" } ]
  },
  "request_id": "0f4a2b1c-…"
}
```

`request_id` is echoed in the `x-request-id` response header on every request and is the
handle to use when reporting a problem.

### Money

`amount` accepts a JSON number (`1250.5`) **or** a decimal string (`"1250.50"`), with at
most two decimal places and a value greater than zero. Responses carry both forms:

```jsonc
{ "amount": 1250.5, "amount_minor": 125050 }
```

Internally every figure is an integer count of minor units, so no rounding error can
accumulate across a balance.

### Status codes

| Code | Meaning in this API |
|---|---|
| `200` | OK |
| `201` | Resource created |
| `204` | Done, nothing to return (member removed, membership left) |
| `400` | Malformed request: validation, bad pagination, bad filter, invalid JSON |
| `401` | Missing, malformed, expired or invalid token |
| `403` | Authenticated but not allowed: wrong role, not a member, escalation blocked |
| `404` | Resource does not exist **in this organization** |
| `405` | Mutating an immutable resource (transaction, transfer) |
| `409` | Conflict: duplicate `reference_id`, duplicate email, duplicate account name |
| `422` | Valid request that breaks a business rule: insufficient balance, frozen account, last owner |
| `429` | Rate limited |
| `500` | Unexpected — the response carries a `request_id` for correlation |
| `503` | Ledger busy (concurrent writer held the write lock) |

### Error codes

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A field failed its schema; `details[]` names each field |
| `MALFORMED_JSON` | 400 | Body is not parseable JSON |
| `INVALID_PAGINATION` | 400 | `page`/`limit` not a positive integer, `limit > 100` |
| `INVALID_FILTER` | 400 | `min_amount > max_amount`, `from` after `to` |
| `UNAUTHENTICATED` | 401 | No bearer token |
| `INVALID_TOKEN` / `TOKEN_EXPIRED` | 401 | Token rejected |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (same message for both) |
| `ORG_ACCESS_DENIED` | 403 | Authenticated user is not a member of `:orgId` |
| `INSUFFICIENT_ROLE` | 403 | Role lacks the permission; `details[].required_permission` says which |
| `ROLE_ESCALATION_BLOCKED` | 403 | Assigning/managing a role at or above your own |
| `SELF_ROLE_CHANGE_BLOCKED` / `SELF_REMOVAL_BLOCKED` | 403 | Acting on your own membership |
| `ORGANIZATION_NOT_FOUND` | 404 | Unknown `:orgId` |
| `ACCOUNT_NOT_FOUND` | 404 | Unknown account **or** an account in another organization |
| `TRANSACTION_NOT_FOUND` / `TRANSFER_NOT_FOUND` / `MEMBER_NOT_FOUND` | 404 | Unknown id |
| `ROUTE_NOT_FOUND` | 404 | No route matched |
| `TRANSACTION_IMMUTABLE` / `TRANSFER_IMMUTABLE` | 405 | PUT/PATCH/DELETE on a ledger record |
| `DUPLICATE_REFERENCE_ID` | 409 | `reference_id` already used on that account/organization |
| `EMAIL_ALREADY_REGISTERED` | 409 | Email already has an account |
| `ACCOUNT_NAME_TAKEN` | 409 | Account name already used in this organization |
| `ALREADY_A_MEMBER` | 409 | User already belongs to the organization |
| `INSUFFICIENT_BALANCE` | 422 | Debit or transfer exceeds the available balance |
| `ACCOUNT_NOT_ACTIVE` | 422 | Account is frozen or closed |
| `ACCOUNT_NOT_EMPTY` | 422 | Closing an account that still holds money |
| `CURRENCY_MISMATCH` | 422 | Transfer between accounts of different currencies |
| `LAST_OWNER_PROTECTED` | 422 | The organization would be left without an OWNER |
| `RATE_LIMITED` | 429 | Too many requests in the window |
| `LEDGER_BUSY` | 503 | SQLite write lock held; retry |

---

## Authentication

### `POST /auth/register`

Creates a user, their first organization and an `OWNER` membership — in one transaction.

```json
{
  "name": "Akarsh Shrivastava",
  "email": "akarsh@confluencr.com",
  "password": "Password123!",
  "organization_name": "Confluencr Media Pvt Ltd",
  "currency": "INR"
}
```

`201`

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs…",
    "token_type": "Bearer",
    "expires_in": "12h",
    "user": { "id": "usr_01J…", "name": "Akarsh Shrivastava", "email": "akarsh@confluencr.com" },
    "organization": { "id": "org_01J…", "name": "Confluencr Media Pvt Ltd",
                      "slug": "confluencr-media-pvt-ltd", "currency": "INR", "role": "OWNER" }
  }
}
```

Errors: `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_REGISTERED`.
`organization_name` is optional — it defaults to `"<first name>'s Organization"`.

### `POST /auth/login`

```json
{ "email": "owner@confluencr.test", "password": "Password123!" }
```

`200` → token plus the list of organizations you belong to. An unknown email and a wrong
password return the **same** `401 INVALID_CREDENTIALS`, so the endpoint cannot be used to
discover which emails are registered.

### `GET /auth/me`

Identity, every membership, that membership's permissions and headline counters. The web
console uses this to decide which screens and buttons to render.

### `GET /auth/roles`

Static role → permission matrix. No auth required; the Access Control screen renders it
directly.

```json
{ "data": [ { "role": "OWNER", "rank": 50, "permissions": ["account:create", "…"] }, … ] }
```

---

## Organizations & members

| Method | Path | Permission |
|---|---|---|
| `GET` | `/organizations` | — (your memberships) |
| `POST` | `/organizations` | — (you become OWNER) |
| `GET` | `/organizations/:orgId` | `org:read` |
| `PATCH` | `/organizations/:orgId` | `org:update` |
| `GET` | `/organizations/:orgId/members` | `member:read` |
| `POST` | `/organizations/:orgId/members` | `member:manage` |
| `PATCH` | `/organizations/:orgId/members/:userId` | `member:manage` |
| `DELETE` | `/organizations/:orgId/members/:userId` | `member:manage` |
| `DELETE` | `/organizations/:orgId/membership` | `org:read` (leave) |
| `GET` | `/organizations/:orgId/audit-logs` | `audit:read` |

### `POST /organizations/:orgId/members`

```json
{ "email": "riya@confluencr.com", "role": "ADMIN", "name": "Riya Malhotra" }
```

`201`

```jsonc
{
  "data": {
    "id": "mem_01J…", "role": "ADMIN",
    "permissions": ["account:create", "member:manage", "…"],
    "user": { "id": "usr_01J…", "name": "Riya Malhotra", "email": "riya@confluencr.com" },
    "temporary_password": "Cnf-8sJ2kQ"   // only when a new user account was created
  }
}
```

`temporary_password` is returned exactly once. It exists so the full RBAC flow can be
demonstrated without wiring an email provider; a production build would send an
invitation link instead.

Errors: `409 ALREADY_A_MEMBER`, `403 ROLE_ESCALATION_BLOCKED` (an ADMIN inviting an
OWNER), `400 VALIDATION_ERROR` (unknown role).

### `PATCH /organizations/:orgId/members/:userId`

```json
{ "role": "EDITOR" }
```

Blocked by `403 SELF_ROLE_CHANGE_BLOCKED` on yourself, and by
`403 ROLE_ESCALATION_BLOCKED` when the actor does not outrank both the current and the
requested role.

### `GET /organizations/:orgId/audit-logs?page=&limit=`

Paginated, newest first.

```jsonc
{
  "data": [
    {
      "id": "aud_01J…",
      "action": "transfer.executed",
      "entity_type": "transfer",
      "entity_id": "TRF-204",
      "actor": { "user_id": "usr_01J…", "email": "owner@confluencr.test", "role": "OWNER" },
      "metadata": { "from_account_id": "acc_…", "to_account_id": "acc_…", "amount": "5000.00" },
      "ip_address": "::1",
      "created_at": "2026-10-27T09:12:44.512Z"
    }
  ],
  "meta": { "pagination": { … } }
}
```

---

## Accounts

### `POST /organizations/:orgId/accounts` — `account:create`

```json
{
  "name": "Creator Payouts",
  "holder_email": "finance@brand.com",
  "currency": "INR",
  "opening_balance": "25000.00"
}
```

Only `name` is required. `opening_balance` is optional and is recorded as a normal credit
entry with reference `OPENING-<account code>`, so the invariant *balance = sum of
entries* holds from the very first second.

`201`

```json
{
  "data": {
    "id": "acc_01J…", "code": "AC-4KQ9-2F7B", "name": "Creator Payouts",
    "currency": "INR", "status": "active",
    "balance": 25000, "balance_minor": 2500000,
    "created_at": "2026-10-27T09:00:00.000Z", "updated_at": "2026-10-27T09:00:00.000Z"
  }
}
```

Errors: `400 VALIDATION_ERROR` (missing name), `409 ACCOUNT_NAME_TAKEN`.

### `GET /organizations/:orgId/accounts` — `account:read`

| Query | Default | Notes |
|---|---|---|
| `page` | `1` | ≥ 1 |
| `limit` | `20` | 1–100 |
| `q` | — | Matches name or account code, case-insensitive |
| `status` | — | `active` \| `frozen` \| `closed` |
| `sort` | `created_at` | `created_at` \| `name` \| `balance` |
| `order` | `desc` | `asc` \| `desc` |

Each row carries `transaction_count` alongside the balance.

### `GET /organizations/:orgId/accounts/:accountId` — `account:read`

`404 ACCOUNT_NOT_FOUND` for an unknown id **and** for an account that belongs to another
organization — the API never confirms the existence of another tenant's data.

### `PATCH /organizations/:orgId/accounts/:accountId` — `account:update`

```json
{ "name": "Creator Payouts (APAC)", "status": "frozen" }
```

Metadata only. There is no field that writes a balance; sending `balance` is ignored.
A frozen or closed account rejects new entries with `422 ACCOUNT_NOT_ACTIVE`, and closing
an account with a non-zero balance returns `422 ACCOUNT_NOT_EMPTY`.

---

## Transactions

### `POST /organizations/:orgId/transactions` — `transaction:create`

```json
{
  "account_id": "acc_01J…",
  "type": "credit",
  "amount": 1500.75,
  "reference_id": "INV-2026-0041",
  "description": "Brand campaign invoice settled"
}
```

`201`

```jsonc
{
  "data": {
    "id": "txn_01J…",
    "account_id": "acc_01J…",
    "type": "credit",
    "amount": 1500.75, "amount_minor": 150075,
    "balance_after": 26500.75,
    "reference_id": "INV-2026-0041",
    "description": "Brand campaign invoice settled",
    "transfer_id": null,
    "created_by": "usr_01J…",
    "created_at": "2026-10-27T09:15:02.441Z",
    "account": { "id": "acc_01J…", "balance": 26500.75, "…": "…" }   // refreshed account
  }
}
```

The same body may be posted to
`POST /organizations/:orgId/accounts/:accountId/transactions`, where `account_id` comes
from the path.

**Validation and business rules**

| Case | Response |
|---|---|
| `account_id` missing / unknown / other tenant | `400 VALIDATION_ERROR` / `404 ACCOUNT_NOT_FOUND` |
| `type` not `credit` or `debit` | `400 VALIDATION_ERROR` |
| `amount` ≤ 0, more than 2 decimals, not numeric | `400 VALIDATION_ERROR` |
| `reference_id` missing or > 100 chars | `400 VALIDATION_ERROR` |
| `reference_id` already used on that account | `409 DUPLICATE_REFERENCE_ID` (+ `existing_transaction_id`) |
| Debit larger than the balance | `422 INSUFFICIENT_BALANCE` (+ available / requested / shortfall) |
| Account frozen or closed | `422 ACCOUNT_NOT_ACTIVE` |

A rejected transaction writes nothing: no entry, no balance change, no audit row.

### `GET /organizations/:orgId/transactions` — `transaction:read`

Latest first by default.

| Query | Default | Notes |
|---|---|---|
| `page` / `limit` | `1` / `20` | `limit` ≤ 100 |
| `account_id` | — | Restrict to one account |
| `type` | — | `credit` \| `debit` |
| `reference_id` | — | Exact match |
| `q` | — | Substring of description or reference |
| `from` / `to` | — | ISO-8601; `from` must be ≤ `to` |
| `min_amount` / `max_amount` | — | Decimal; `min` must be ≤ `max` |
| `transfers_only` | `false` | Only legs that belong to a transfer |
| `sort` | `created_at` | `created_at` \| `amount` |
| `order` | `desc` | `asc` \| `desc` |

`meta.totals` reports the credit/debit/net totals **for the whole filter set**, not just
the current page.

Ordering is `created_at DESC, id DESC`. Ids are monotonic ULIDs, so two entries written in
the same millisecond still have a stable, correct order and never repeat or disappear
across pages.

### `GET /organizations/:orgId/transactions/:transactionId` — `transaction:read`

### `GET /organizations/:orgId/transactions/export` — `transaction:read`

Returns `text/csv` for the current filter set (same query parameters as the list, up to
10 000 rows) with a `content-disposition` attachment header.

### Immutability

```
PUT    /organizations/:orgId/transactions/:transactionId  → 405 TRANSACTION_IMMUTABLE
PATCH  /organizations/:orgId/transactions/:transactionId  → 405 TRANSACTION_IMMUTABLE
DELETE /organizations/:orgId/transactions/:transactionId  → 405 TRANSACTION_IMMUTABLE
```

```json
{
  "error": {
    "code": "TRANSACTION_IMMUTABLE",
    "message": "Transactions are immutable: they cannot be edited or deleted once created. Post a compensating transaction instead."
  },
  "request_id": "…"
}
```

The database enforces the same rule with `BEFORE UPDATE` and `BEFORE DELETE` triggers, so
the guarantee survives any code path, including direct SQL.

---

## Transfers (bonus)

### `POST /organizations/:orgId/transfers` — `transfer:create`

```json
{
  "from_account_id": "acc_A…",
  "to_account_id": "acc_B…",
  "amount": 30,
  "reference_id": "TRF-2026-014",
  "description": "Monthly rebalance"
}
```

`201`

```jsonc
{
  "data": {
    "id": "trf_01J…",
    "from_account_id": "acc_A…", "to_account_id": "acc_B…",
    "amount": 30, "currency": "INR",
    "reference_id": "TRF-2026-014",
    "status": "completed",
    "created_at": "2026-10-27T09:20:11.004Z",
    "debit_transaction":  { "type": "debit",  "amount": 30, "balance_after": 70, "…": "…" },
    "credit_transaction": { "type": "credit", "amount": 30, "balance_after": 80, "…": "…" },
    "from_account": { "balance": 70, "…": "…" },
    "to_account":   { "balance": 80, "…": "…" }
  }
}
```

The worked example from the brief: A = 100, B = 50, transfer 30 → A = 70, B = 80.

**Rules**

| Case | Response |
|---|---|
| Either account unknown or in another organization | `404 ACCOUNT_NOT_FOUND` |
| `from_account_id == to_account_id` | `400 VALIDATION_ERROR` |
| Source balance too low | `422 INSUFFICIENT_BALANCE` — nothing is written |
| Either account frozen/closed | `422 ACCOUNT_NOT_ACTIVE` |
| Different currencies | `422 CURRENCY_MISMATCH` |
| `reference_id` already used | `409 DUPLICATE_REFERENCE_ID` |

The header, both legs and both balance updates are written inside a single SQLite
transaction. A partial transfer is not representable: either all five writes commit, or
none of them do.

### `GET /organizations/:orgId/transfers?page=&limit=&account_id=` — `transfer:read`

### `GET /organizations/:orgId/transfers/:transferId` — `transfer:read`

Returns the header plus `legs[]` — the debit and the credit entry that belong to it.

Transfers are immutable too: `PUT`/`PATCH`/`DELETE` → `405 TRANSFER_IMMUTABLE`. Reverse
one by creating a transfer in the opposite direction.

---

## Analytics — `analytics:read`

All eight endpoints are scoped to the organization in the path.

| Endpoint | Returns |
|---|---|
| `GET …/analytics/overview` | Account counts by status, total/largest/average balance, all-time credit & debit totals, net flow, average and largest entry, credit share, last-7-day figures, transfer and member counts |
| `GET …/analytics/cashflow?days=1..365` | One row per day (gaps filled with zeroes): `credit`, `debit`, `net`, `cumulative_balance`, `transaction_count`. The cumulative series ends on today's real total balance. |
| `GET …/analytics/balance-distribution?limit=1..50` | Share of total balance per account, largest first; accounts past `limit` are folded into one `__other__` slice |
| `GET …/analytics/type-split` | Credit vs debit by count and by value, with both shares |
| `GET …/analytics/account-matrix` | Per account: balance, entry count, credited, debited, throughput, last activity — the bubble-chart source |
| `GET …/analytics/activity-heatmap?days=1..365` | Entry counts and value bucketed by UTC weekday × hour |
| `GET …/analytics/top-accounts?limit=1..50` | Busiest accounts by entry count |
| `GET …/ledger/integrity` | Re-derives every balance from the transaction log; `200` with `consistent: true`, or `500` listing the mismatching accounts |

Analytics group by **UTC** day; `meta.timezone` says so explicitly.

```jsonc
// GET /organizations/:orgId/ledger/integrity
{
  "data": {
    "checked_accounts": 8,
    "consistent": true,
    "total_stored_balance": 2328136,
    "total_derived_balance": 2328136,
    "mismatches": []
  }
}
```

---

## Service endpoints

### `GET /health`

```json
{
  "data": {
    "status": "ok", "service": "confluencr-ledger-api", "version": "1.0.0",
    "environment": "development", "database": "sqlite",
    "uptime_seconds": 412, "timestamp": "2026-10-27T09:30:00.000Z"
  }
}
```

### `GET /api/v1`

A self-describing index of every route, so the API can be explored without opening this
document.

---

## Rate limiting

A fixed window per client IP, split between `/auth/*` and the rest of the API:
`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` (default 600 per minute). Exceeding
it returns `429 RATE_LIMITED` with a `retry-after` header. The limiter is in-process and
is disabled while tests run.
