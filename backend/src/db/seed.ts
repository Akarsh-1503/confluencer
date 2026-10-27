import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import type { AccountRow, TransactionType } from './types.js';
import { verifyLedgerIntegrity } from '../modules/ledger/ledger.service.js';
import { accountCode, newAccountId, newTransactionId, newTransferId } from '../utils/id.js';
import { formatMajorUnits } from '../utils/money.js';
import { closeDb, getDb, useDatabase, openDatabase, withTransaction } from './index.js';
import { insertUser } from '../modules/auth/users.repository.js';
import {
  insertMembership,
  insertOrganization,
} from '../modules/organizations/organizations.repository.js';

/* -------------------------------------------------------------------------- *
 * Deterministic demo data.
 *
 * `npm run seed` RESETS the database file at DATABASE_PATH and rebuilds it, so the
 * dashboard always opens on the same 90 days of ledger history. Transactions are
 * written with backdated `created_at` values, which is why this script talks to the
 * tables directly instead of going through the API's ledger service.
 * -------------------------------------------------------------------------- */

const PASSWORD = 'Password123!';
const DAYS_OF_HISTORY = 90;

/** Small LCG so every seed run produces the same numbers. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = makeRandom(20261027);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (min: number, max: number) => min + random() * (max - min);

function resetDatabaseFile(): void {
  if (env.databasePath === ':memory:') return;
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${env.databasePath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

type SeedAccount = {
  row: AccountRow;
  balanceMinor: number;
};

const ACCOUNT_BLUEPRINTS = [
  { name: 'Operating Account', opening: 48_500_000, weight: 1.0 },
  { name: 'Brand Escrow — Nykaa', opening: 32_400_000, weight: 0.8 },
  { name: 'Brand Escrow — Mamaearth', opening: 21_750_000, weight: 0.7 },
  { name: 'Creator Payouts', opening: 16_200_000, weight: 1.2 },
  { name: 'Ad Spend — Meta', opening: 12_900_000, weight: 1.1 },
  { name: 'Ad Spend — Google', opening: 9_750_000, weight: 0.9 },
  { name: 'Talent Advance — Kalakaaar', opening: 7_600_000, weight: 0.5 },
  { name: 'GST Reserve', opening: 14_100_000, weight: 0.3 },
] as const;

const CREDIT_NOTES = [
  'Brand campaign invoice settled',
  'Retainer received',
  'Performance bonus from brand',
  'Marketplace payout',
  'Refund from ad platform',
  'Influencer deliverable milestone',
];

const DEBIT_NOTES = [
  'Creator payout batch',
  'Meta ads top-up',
  'Google ads top-up',
  'Talent advance disbursed',
  'GST remittance',
  'Studio production cost',
  'Platform commission settled',
];

function isoAt(daysAgo: number, hour: number, minute: number, second: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, minute, second, Math.floor(random() * 1000));
  // Today's entries must not land in the future, or "latest first" looks wrong.
  const now = Date.now();
  if (date.getTime() > now) date.setTime(now - Math.floor(random() * 3_600_000));
  return date.toISOString();
}

async function seed(): Promise<void> {
  resetDatabaseFile();
  useDatabase(openDatabase());
  const db = getDb();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const summary = withTransaction(() => {
    const owner = insertUser(
      { email: 'owner@confluencr.test', name: 'Akarsh Shrivastava', passwordHash },
      db,
    );
    const admin = insertUser(
      { email: 'admin@confluencr.test', name: 'Riya Malhotra', passwordHash },
      db,
    );
    const editor = insertUser(
      { email: 'editor@confluencr.test', name: 'Devansh Rao', passwordHash },
      db,
    );
    const auditor = insertUser(
      { email: 'auditor@confluencr.test', name: 'Neha Iyer', passwordHash },
      db,
    );
    const reader = insertUser(
      { email: 'reader@confluencr.test', name: 'Kabir Shah', passwordHash },
      db,
    );

    const organization = insertOrganization(
      { name: 'Confluencr Media Pvt Ltd', currency: 'INR', createdBy: owner.id },
      db,
    );

    insertMembership({ orgId: organization.id, userId: owner.id, role: 'OWNER' }, db);
    insertMembership(
      { orgId: organization.id, userId: admin.id, role: 'ADMIN', invitedBy: owner.id },
      db,
    );
    insertMembership(
      { orgId: organization.id, userId: editor.id, role: 'EDITOR', invitedBy: owner.id },
      db,
    );
    insertMembership(
      { orgId: organization.id, userId: auditor.id, role: 'AUDITOR', invitedBy: owner.id },
      db,
    );
    insertMembership(
      { orgId: organization.id, userId: reader.id, role: 'READER', invitedBy: owner.id },
      db,
    );

    // A second organization proves tenant isolation in the UI switcher.
    const secondOrg = insertOrganization(
      { name: 'Intent Farm Performance', currency: 'INR', createdBy: owner.id },
      db,
    );
    insertMembership({ orgId: secondOrg.id, userId: owner.id, role: 'OWNER' }, db);
    insertMembership(
      { orgId: secondOrg.id, userId: admin.id, role: 'READER', invitedBy: owner.id },
      db,
    );

    const insertAccountStmt = db.prepare(
      `INSERT INTO accounts
         (id, org_id, code, name, holder_email, currency, status, balance_minor, created_by, created_at, updated_at)
       VALUES (@id, @org_id, @code, @name, @holder_email, @currency, @status, @balance_minor, @created_by, @created_at, @updated_at)`,
    );
    const insertTxStmt = db.prepare(
      `INSERT INTO transactions
         (id, org_id, account_id, type, amount_minor, balance_after_minor, description,
          reference_id, transfer_id, counterparty_account_id, created_by, created_at)
       VALUES (@id, @org_id, @account_id, @type, @amount_minor, @balance_after_minor, @description,
          @reference_id, @transfer_id, @counterparty_account_id, @created_by, @created_at)`,
    );
    const updateBalanceStmt = db.prepare(
      'UPDATE accounts SET balance_minor = ?, updated_at = ? WHERE id = ?',
    );
    const insertTransferStmt = db.prepare(
      `INSERT INTO transfers
         (id, org_id, from_account_id, to_account_id, amount_minor, currency, reference_id,
          description, status, created_by, created_at)
       VALUES (@id, @org_id, @from_account_id, @to_account_id, @amount_minor, @currency, @reference_id,
          @description, @status, @created_by, @created_at)`,
    );

    const openedAt = isoAt(DAYS_OF_HISTORY + 1, 9, 0, 0);
    const accounts: SeedAccount[] = ACCOUNT_BLUEPRINTS.map((blueprint) => {
      const row: AccountRow = {
        id: newAccountId(),
        org_id: organization.id,
        code: accountCode(),
        name: blueprint.name,
        holder_email: null,
        currency: 'INR',
        status: 'active',
        balance_minor: 0,
        created_by: owner.id,
        created_at: openedAt,
        updated_at: openedAt,
      };
      insertAccountStmt.run(row);
      return { row, balanceMinor: 0 };
    });

    let txCount = 0;
    let transferCount = 0;
    const authors = [owner, admin, editor];

    const post = (
      account: SeedAccount,
      type: TransactionType,
      amountMinor: number,
      description: string,
      referenceId: string,
      createdAt: string,
      extras?: { transferId?: string; counterpartyAccountId?: string },
    ) => {
      const nextBalance =
        type === 'credit' ? account.balanceMinor + amountMinor : account.balanceMinor - amountMinor;
      if (nextBalance < 0) return false;
      insertTxStmt.run({
        id: newTransactionId(),
        // Always take the tenant from the account itself, never from an outer variable.
        org_id: account.row.org_id,
        account_id: account.row.id,
        type,
        amount_minor: amountMinor,
        balance_after_minor: nextBalance,
        description,
        reference_id: referenceId,
        transfer_id: extras?.transferId ?? null,
        counterparty_account_id: extras?.counterpartyAccountId ?? null,
        created_by: pick(authors).id,
        created_at: createdAt,
      });
      account.balanceMinor = nextBalance;
      updateBalanceStmt.run(nextBalance, createdAt, account.row.id);
      txCount += 1;
      return true;
    };

    // Opening balances are ordinary credit entries so that
    // "balance == sum of transactions" holds for every account.
    ACCOUNT_BLUEPRINTS.forEach((blueprint, index) => {
      const account = accounts[index] as SeedAccount;
      post(
        account,
        'credit',
        blueprint.opening,
        'Opening balance',
        `OPENING-${account.row.code}`,
        isoAt(DAYS_OF_HISTORY, 10, index, 0),
        undefined,
      );
    });

    for (let daysAgo = DAYS_OF_HISTORY - 1; daysAgo >= 0; daysAgo -= 1) {
      const weekday = new Date(isoAt(daysAgo, 12, 0, 0)).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const volume = Math.round(between(isWeekend ? 1 : 4, isWeekend ? 4 : 11));

      for (let i = 0; i < volume; i += 1) {
        const blueprintIndex = Math.floor(random() * accounts.length);
        const account = accounts[blueprintIndex] as SeedAccount;
        const weight = ACCOUNT_BLUEPRINTS[blueprintIndex]?.weight ?? 1;
        const type: TransactionType = random() < 0.52 ? 'credit' : 'debit';
        const magnitude = Math.round(between(120_000, 3_600_000) * weight);
        const amountMinor = Math.max(50_000, Math.round(magnitude / 100) * 100);
        const createdAt = isoAt(
          daysAgo,
          Math.floor(between(8, 21)),
          Math.floor(between(0, 60)),
          Math.floor(between(0, 60)),
        );
        const reference = `TXN-${String(daysAgo).padStart(3, '0')}-${String(i).padStart(2, '0')}-${blueprintIndex}`;
        post(
          account,
          type,
          amountMinor,
          type === 'credit' ? pick(CREDIT_NOTES) : pick(DEBIT_NOTES),
          reference,
          createdAt,
        );
      }

      // A couple of internal transfers each week, written as a header plus two legs.
      if (daysAgo % 4 === 0) {
        const fromIndex = Math.floor(random() * accounts.length);
        let toIndex = Math.floor(random() * accounts.length);
        if (toIndex === fromIndex) toIndex = (toIndex + 1) % accounts.length;
        const from = accounts[fromIndex] as SeedAccount;
        const to = accounts[toIndex] as SeedAccount;
        const amountMinor = Math.max(
          50_000,
          Math.round(Math.min(from.balanceMinor * 0.25, between(400_000, 3_200_000)) / 100) * 100,
        );

        if (amountMinor > 0 && from.balanceMinor >= amountMinor) {
          const createdAt = isoAt(daysAgo, 17, Math.floor(between(0, 59)), 0);
          const transferId = newTransferId();
          const reference = `TRF-${String(daysAgo).padStart(3, '0')}`;
          insertTransferStmt.run({
            id: transferId,
            org_id: organization.id,
            from_account_id: from.row.id,
            to_account_id: to.row.id,
            amount_minor: amountMinor,
            currency: 'INR',
            reference_id: reference,
            description: `Internal rebalance ${from.row.name} -> ${to.row.name}`,
            status: 'completed',
            created_by: owner.id,
            created_at: createdAt,
          });
          post(
            from,
            'debit',
            amountMinor,
            `Transfer to ${to.row.name}`,
            reference,
            createdAt,
            { transferId, counterpartyAccountId: to.row.id },
          );
          post(
            to,
            'credit',
            amountMinor,
            `Transfer from ${from.row.name}`,
            reference,
            createdAt,
            { transferId, counterpartyAccountId: from.row.id },
          );
          transferCount += 1;
        }
      }
    }

    // Second organization: two small accounts, so its dashboard is not empty.
    const secondAccounts: SeedAccount[] = ['Performance Media Pool', 'Marketplace Settlements'].map(
      (name, index) => {
        const row: AccountRow = {
          id: newAccountId(),
          org_id: secondOrg.id,
          code: accountCode(),
          name,
          holder_email: null,
          currency: 'INR',
          status: 'active',
          balance_minor: 0,
          created_by: owner.id,
          created_at: isoAt(30, 11, index, 0),
          updated_at: isoAt(30, 11, index, 0),
        };
        insertAccountStmt.run(row);
        return { row, balanceMinor: 0 };
      },
    );

    secondAccounts.forEach((account, index) => {
      post(
        account,
        'credit',
        18_250_000 + index * 4_400_000,
        'Opening balance',
        `OPENING-${account.row.code}`,
        isoAt(30, 11, index + 1, 0),
      );
      for (let i = 0; i < 12; i += 1) {
        const type: TransactionType = random() < 0.5 ? 'credit' : 'debit';
        post(
          account,
          type,
          Math.round(between(180_000, 1_800_000) / 100) * 100,
          type === 'credit' ? pick(CREDIT_NOTES) : pick(DEBIT_NOTES),
          `IF-${index}-${i}`,
          isoAt(Math.floor(between(0, 29)), Math.floor(between(9, 20)), i, 0),
        );
      }
    });

    const frozen = accounts[accounts.length - 1] as SeedAccount;
    db.prepare("UPDATE accounts SET status = 'frozen' WHERE id = ?").run(frozen.row.id);

    return {
      organization,
      secondOrg,
      accounts: accounts.length + secondAccounts.length,
      txCount,
      transferCount,
      totalBalanceMinor: accounts.reduce((sum, account) => sum + account.balanceMinor, 0),
    };
  });

  const integrity = verifyLedgerIntegrity(summary.organization.id);

  console.log('[seed] database        :', env.databasePath);
  console.log('[seed] organizations   :', `${summary.organization.name} + ${summary.secondOrg.name}`);
  console.log('[seed] accounts        :', summary.accounts);
  console.log('[seed] transactions    :', summary.txCount);
  console.log('[seed] transfers       :', summary.transferCount);
  console.log('[seed] total balance   :', formatMajorUnits(summary.totalBalanceMinor), 'INR');
  console.log('[seed] ledger integrity:', integrity.consistent ? 'consistent' : 'MISMATCH');
  console.log('');
  console.log('[seed] demo logins (password for all: %s)', PASSWORD);
  for (const account of [
    ['owner@confluencr.test', 'OWNER'],
    ['admin@confluencr.test', 'ADMIN'],
    ['editor@confluencr.test', 'EDITOR'],
    ['auditor@confluencr.test', 'AUDITOR'],
    ['reader@confluencr.test', 'READER'],
  ]) {
    console.log(`         ${account[1]?.padEnd(8)} ${account[0]}`);
  }

  if (!integrity.consistent) {
    closeDb();
    process.exitCode = 1;
    return;
  }
  closeDb();
}

await seed();
