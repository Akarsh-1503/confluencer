import { randomBytes, randomUUID } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTimestamp = -1;
let lastRandom: number[] = [];

function encodeTime(timestamp: number): string {
  let out = '';
  let value = timestamp;
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function freshRandom(): number[] {
  return Array.from(randomBytes(16)).slice(0, 16).map((byte) => byte % 32);
}

/** Increments the random part so two ids minted in the same millisecond still sort. */
function bumpRandom(previous: number[]): number[] {
  const next = [...previous];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const slot = next[i] ?? 0;
    if (slot < 31) {
      next[i] = slot + 1;
      return next;
    }
    next[i] = 0;
  }
  return freshRandom();
}

/**
 * Monotonic ULID. Lexicographic order equals creation order, which lets the ledger use
 * `ORDER BY created_at DESC, id DESC` and still be deterministic for rows that share a
 * millisecond timestamp.
 */
export function ulid(now: number = Date.now()): string {
  if (now === lastTimestamp) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastTimestamp = now;
    lastRandom = freshRandom();
  }
  const randomPart = lastRandom.map((slot) => CROCKFORD[slot]).join('');
  return encodeTime(now) + randomPart;
}

export const newId = (prefix: string): string => `${prefix}_${ulid()}`;

export const newUserId = () => newId('usr');
export const newOrgId = () => newId('org');
export const newMembershipId = () => newId('mem');
export const newAccountId = () => newId('acc');
export const newTransactionId = () => newId('txn');
export const newTransferId = () => newId('trf');
export const newAuditId = () => newId('aud');
export const newRequestId = () => randomUUID();

/** Short, human readable account code such as `AC-4KQ9-2F7B`. */
export function accountCode(): string {
  const chunk = () =>
    Array.from(randomBytes(4))
      .map((byte) => CROCKFORD[byte % 32])
      .join('');
  return `AC-${chunk()}-${chunk()}`;
}

/** URL-safe slug used for organization handles. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'org';
}
