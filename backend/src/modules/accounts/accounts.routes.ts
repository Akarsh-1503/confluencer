import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { orgContext, requirePermission, resolveOrgContext } from '../../middleware/orgContext.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { parsePositiveAmount } from '../../utils/money.js';
import { buildPageMeta, parsePagination } from '../../utils/pagination.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  amountInputSchema,
  currencySchema,
  emailSchema,
  orgIdParams,
  paginationQueryShape,
  requiredString,
  sortOrderSchema,
} from '../common/schemas.js';
import { postTransaction } from '../ledger/ledger.service.js';
import {
  findAccount,
  insertAccount,
  listAccounts,
  serializeAccount,
  updateAccount,
} from './accounts.repository.js';

const createAccountSchema = z.object({
  name: requiredString('name', 120),
  currency: currencySchema.optional(),
  holder_email: emailSchema.optional(),
  /** Optional convenience: posts an opening credit so balance stays transaction-derived. */
  opening_balance: amountInputSchema.optional(),
});

const updateAccountSchema = z
  .object({
    name: requiredString('name', 120).optional(),
    status: z.enum(['active', 'frozen', 'closed'], {
      errorMap: () => ({ message: "status must be one of: active, frozen, closed" }),
    }).optional(),
    holder_email: emailSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one of: name, status, holder_email',
  });

const listAccountsQuery = z.object({
  ...paginationQueryShape,
  q: requiredString('q', 120).optional(),
  status: z.enum(['active', 'frozen', 'closed']).optional(),
  sort: z.enum(['created_at', 'name', 'balance']).default('created_at'),
  order: sortOrderSchema,
});

const accountParams = orgIdParams.extend({
  accountId: requiredString('accountId', 64),
});

export const accountsRouter = Router({ mergeParams: true });

accountsRouter.use(authenticate, validateParams(orgIdParams), resolveOrgContext);

accountsRouter.get(
  '/',
  requirePermission('account:read'),
  validateQuery(listAccountsQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const query = req.query as unknown as z.infer<typeof listAccountsQuery>;
    const page = parsePagination(req.query as Record<string, unknown>);

    const { rows, total } = listAccounts({
      orgId: org.id,
      search: query.q,
      status: query.status,
      sort: query.sort,
      order: query.order,
      limit: page.limit,
      offset: page.offset,
    });

    res.json({
      data: rows.map(serializeAccount),
      meta: {
        pagination: buildPageMeta(page, total),
        sort: { field: query.sort, order: query.order },
      },
    });
  }),
);

accountsRouter.post(
  '/',
  requirePermission('account:create'),
  validateBody(createAccountSchema),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const body = req.body as z.infer<typeof createAccountSchema>;

    const openingMinor =
      body.opening_balance === undefined
        ? 0
        : parsePositiveAmount(body.opening_balance, 'opening_balance');

    const account = insertAccount({
      orgId: org.id,
      name: body.name,
      currency: body.currency ?? org.currency,
      holderEmail: body.holder_email ?? null,
      createdBy: auth.userId,
    });

    recordAudit(req, {
      action: 'account.created',
      entityType: 'account',
      entityId: account.id,
      metadata: { name: account.name, currency: account.currency },
    });

    // An opening balance is an ordinary credit entry, which keeps the invariant
    // "balance == sum of transactions" true for every account from the first second.
    let created = account;
    if (openingMinor > 0) {
      const posted = postTransaction(
        {
          orgId: org.id,
          accountId: account.id,
          type: 'credit',
          amountMinor: openingMinor,
          referenceId: `OPENING-${account.code}`,
          description: 'Opening balance',
          actorId: auth.userId,
        },
        (db) =>
          recordAudit(
            req,
            {
              action: 'transaction.created',
              entityType: 'transaction',
              entityId: account.id,
              metadata: { reason: 'opening_balance', amount_minor: openingMinor },
            },
            db,
          ),
      );
      created = posted.account;
    }

    res.status(201).json({ data: serializeAccount(created) });
  }),
);

accountsRouter.get(
  '/:accountId',
  requirePermission('account:read'),
  validateParams(accountParams),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { accountId } = req.params as z.infer<typeof accountParams>;
    const account = findAccount(org.id, accountId);
    if (!account) {
      throw AppError.notFound(
        'ACCOUNT_NOT_FOUND',
        `No account exists with id "${accountId}" in this organization`,
      );
    }
    res.json({ data: serializeAccount(account) });
  }),
);

/**
 * Metadata-only update. There is deliberately no way to write `balance` here: the only
 * thing that can move a balance is a transaction or a transfer.
 */
accountsRouter.patch(
  '/:accountId',
  requirePermission('account:update'),
  validateParams(accountParams),
  validateBody(updateAccountSchema),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { accountId } = req.params as z.infer<typeof accountParams>;
    const body = req.body as z.infer<typeof updateAccountSchema>;

    const existing = findAccount(org.id, accountId);
    if (!existing) {
      throw AppError.notFound(
        'ACCOUNT_NOT_FOUND',
        `No account exists with id "${accountId}" in this organization`,
      );
    }
    if (body.status === 'closed' && existing.balance_minor !== 0) {
      throw AppError.unprocessable(
        'ACCOUNT_NOT_EMPTY',
        'An account must have a zero balance before it can be closed',
      );
    }

    const updated = updateAccount(org.id, accountId, {
      name: body.name,
      status: body.status,
      holderEmail: body.holder_email,
    });

    recordAudit(req, {
      action: 'account.updated',
      entityType: 'account',
      entityId: accountId,
      metadata: { changes: body },
    });

    res.json({ data: serializeAccount(updated!) });
  }),
);
