import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { orgContext, requirePermission, resolveOrgContext } from '../../middleware/orgContext.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { formatMajorUnits, parsePositiveAmount, toMinorUnits } from '../../utils/money.js';
import { buildPageMeta, parsePagination } from '../../utils/pagination.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  amountInputSchema,
  booleanQuerySchema,
  isoDateSchema,
  optionalString,
  orgIdParams,
  paginationQueryShape,
  referenceIdSchema,
  requiredString,
  sortOrderSchema,
  transactionTypeSchema,
} from '../common/schemas.js';
import { postTransaction } from '../ledger/ledger.service.js';
import { serializeAccount } from '../accounts/accounts.repository.js';
import {
  aggregateTransactions,
  findTransaction,
  listTransactions,
  serializeTransaction,
  type TransactionListFilters,
} from './transactions.repository.js';

const createTransactionSchema = z.object({
  account_id: requiredString('account_id', 64),
  type: transactionTypeSchema,
  amount: amountInputSchema,
  reference_id: referenceIdSchema,
  description: optionalString('description', 500),
});

const createForAccountSchema = createTransactionSchema.omit({ account_id: true }).extend({
  account_id: requiredString('account_id', 64).optional(),
});

const listTransactionsQuery = z.object({
  ...paginationQueryShape,
  account_id: requiredString('account_id', 64).optional(),
  type: transactionTypeSchema.optional(),
  reference_id: requiredString('reference_id', 100).optional(),
  q: requiredString('q', 120).optional(),
  from: isoDateSchema('from').optional(),
  to: isoDateSchema('to').optional(),
  min_amount: amountInputSchema.optional(),
  max_amount: amountInputSchema.optional(),
  transfers_only: booleanQuerySchema,
  sort: z
    .enum(['created_at', 'amount'], {
      errorMap: () => ({ message: "sort must be 'created_at' or 'amount'" }),
    })
    .default('created_at'),
  order: sortOrderSchema,
});

const transactionParams = orgIdParams.extend({
  transactionId: requiredString('transactionId', 64),
});

function buildFilters(
  orgId: string,
  query: z.infer<typeof listTransactionsQuery>,
  page: { limit: number; offset: number },
  forcedAccountId?: string,
): TransactionListFilters {
  const minAmount =
    query.min_amount === undefined ? undefined : toMinorUnits(query.min_amount, 'min_amount');
  const maxAmount =
    query.max_amount === undefined ? undefined : toMinorUnits(query.max_amount, 'max_amount');

  if (minAmount !== undefined && minAmount < 0) {
    throw AppError.badRequest('INVALID_FILTER', 'min_amount cannot be negative', [
      { field: 'min_amount', message: 'min_amount cannot be negative' },
    ]);
  }
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
    throw AppError.badRequest('INVALID_FILTER', 'min_amount cannot be greater than max_amount', [
      { field: 'min_amount', message: 'min_amount cannot be greater than max_amount' },
    ]);
  }
  if (query.from && query.to && query.from > query.to) {
    throw AppError.badRequest('INVALID_FILTER', 'from must be earlier than to', [
      { field: 'from', message: 'from must be earlier than to' },
    ]);
  }

  return {
    orgId,
    accountId: forcedAccountId ?? query.account_id,
    type: query.type,
    referenceId: query.reference_id,
    search: query.q,
    from: query.from,
    to: query.to,
    minAmountMinor: minAmount,
    maxAmountMinor: maxAmount,
    transfersOnly: query.transfers_only,
    sort: query.sort,
    order: query.order,
    limit: page.limit,
    offset: page.offset,
  };
}

function listHandler(forcedAccountIdFrom?: 'params') {
  return asyncHandler((req, res) => {
    const org = orgContext(req);
    const query = req.query as unknown as z.infer<typeof listTransactionsQuery>;
    const page = parsePagination(req.query as Record<string, unknown>);
    const forcedAccountId =
      forcedAccountIdFrom === 'params' ? (req.params.accountId as string) : undefined;

    const filters = buildFilters(org.id, query, page, forcedAccountId);
    const { rows, total } = listTransactions(filters);

    res.json({
      data: rows.map(serializeTransaction),
      meta: {
        pagination: buildPageMeta(page, total),
        // `created_at` descending is the documented default: latest transaction first.
        sort: { field: filters.sort, order: filters.order },
        totals: aggregateTransactions(filters),
        filters: {
          account_id: filters.accountId ?? null,
          type: filters.type ?? null,
          reference_id: filters.referenceId ?? null,
          q: filters.search ?? null,
          from: filters.from ?? null,
          to: filters.to ?? null,
          transfers_only: Boolean(filters.transfersOnly),
        },
      },
    });
  });
}

function createHandler(accountIdFrom: 'body' | 'params') {
  return asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const body = req.body as z.infer<typeof createForAccountSchema> & { account_id?: string };

    const accountId =
      accountIdFrom === 'params' ? (req.params.accountId as string) : (body.account_id as string);
    if (!accountId) {
      throw AppError.validation('account_id is required', [
        { field: 'account_id', message: 'account_id is required' },
      ]);
    }

    const amountMinor = parsePositiveAmount(body.amount, 'amount');

    const { transaction, account } = postTransaction(
      {
        orgId: org.id,
        accountId,
        type: body.type,
        amountMinor,
        referenceId: body.reference_id,
        description: body.description ?? null,
        actorId: auth.userId,
      },
      (db) =>
        recordAudit(
          req,
          {
            action: 'transaction.created',
            entityType: 'transaction',
            entityId: accountId,
            metadata: {
              type: body.type,
              amount: formatMajorUnits(amountMinor),
              reference_id: body.reference_id,
            },
          },
          db,
        ),
    );

    res.status(201).json({
      data: {
        ...serializeTransaction(transaction),
        account: serializeAccount(account),
      },
    });
  });
}

/* ------------------------------------------------------------------ *
 * /organizations/:orgId/transactions
 * ------------------------------------------------------------------ */
export const transactionsRouter = Router({ mergeParams: true });

transactionsRouter.use(authenticate, validateParams(orgIdParams), resolveOrgContext);

transactionsRouter.get(
  '/',
  requirePermission('transaction:read'),
  validateQuery(listTransactionsQuery),
  listHandler(),
);

transactionsRouter.post(
  '/',
  requirePermission('transaction:create'),
  validateBody(createTransactionSchema),
  createHandler('body'),
);

/** CSV export of the current filter set, for finance teams that live in spreadsheets. */
transactionsRouter.get(
  '/export',
  requirePermission('transaction:read'),
  validateQuery(listTransactionsQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const query = req.query as unknown as z.infer<typeof listTransactionsQuery>;
    const filters = buildFilters(org.id, query, { limit: 10_000, offset: 0 });
    const { rows } = listTransactions(filters);

    const header = [
      'id',
      'created_at',
      'account_code',
      'account_name',
      'type',
      'amount',
      'balance_after',
      'reference_id',
      'description',
    ].join(',');

    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const body = rows
      .map((row) =>
        [
          row.id,
          row.created_at,
          row.account_code,
          row.account_name,
          row.type,
          formatMajorUnits(row.amount_minor),
          formatMajorUnits(row.balance_after_minor),
          row.reference_id,
          row.description ?? '',
        ]
          .map(escape)
          .join(','),
      )
      .join('\n');

    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="transactions-${org.slug}.csv"`);
    res.send(`${header}\n${body}\n`);
  }),
);

transactionsRouter.get(
  '/:transactionId',
  requirePermission('transaction:read'),
  validateParams(transactionParams),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { transactionId } = req.params as z.infer<typeof transactionParams>;
    const transaction = findTransaction(org.id, transactionId);
    if (!transaction) {
      throw AppError.notFound(
        'TRANSACTION_NOT_FOUND',
        `No transaction exists with id "${transactionId}" in this organization`,
      );
    }
    res.json({ data: serializeTransaction(transaction) });
  }),
);

/**
 * Immutability is explicit rather than implied: mutating verbs answer 405 with the
 * reason, instead of a generic 404 that would look like a routing mistake. The database
 * also blocks UPDATE/DELETE on this table with triggers.
 */
const immutable = asyncHandler(() => {
  throw AppError.methodNotAllowed(
    'TRANSACTION_IMMUTABLE',
    'Transactions are immutable: they cannot be edited or deleted once created. Post a compensating transaction instead.',
  );
});

transactionsRouter.put('/:transactionId', immutable);
transactionsRouter.patch('/:transactionId', immutable);
transactionsRouter.delete('/:transactionId', immutable);
transactionsRouter.put('/', immutable);
transactionsRouter.patch('/', immutable);
transactionsRouter.delete('/', immutable);

/* ------------------------------------------------------------------ *
 * /organizations/:orgId/accounts/:accountId/transactions
 * ------------------------------------------------------------------ */
export const accountTransactionsRouter = Router({ mergeParams: true });

accountTransactionsRouter.use(authenticate, validateParams(orgIdParams), resolveOrgContext);

accountTransactionsRouter.get(
  '/',
  requirePermission('transaction:read'),
  validateQuery(listTransactionsQuery),
  listHandler('params'),
);

accountTransactionsRouter.post(
  '/',
  requirePermission('transaction:create'),
  validateBody(createForAccountSchema),
  createHandler('params'),
);

accountTransactionsRouter.put('/:transactionId', immutable);
accountTransactionsRouter.patch('/:transactionId', immutable);
accountTransactionsRouter.delete('/:transactionId', immutable);
