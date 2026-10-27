import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import type { TransferRow } from '../../db/types.js';
import { AppError } from '../../errors/AppError.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { orgContext, requirePermission, resolveOrgContext } from '../../middleware/orgContext.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { formatMajorUnits, parsePositiveAmount, toMajorUnits } from '../../utils/money.js';
import { buildPageMeta, parsePagination } from '../../utils/pagination.js';
import { recordAudit } from '../audit/audit.service.js';
import { serializeAccount } from '../accounts/accounts.repository.js';
import {
  amountInputSchema,
  optionalString,
  orgIdParams,
  paginationQueryShape,
  referenceIdSchema,
  requiredString,
  sortOrderSchema,
} from '../common/schemas.js';
import { executeTransfer } from '../ledger/ledger.service.js';
import { serializeTransaction } from '../transactions/transactions.repository.js';

const createTransferSchema = z.object({
  from_account_id: requiredString('from_account_id', 64),
  to_account_id: requiredString('to_account_id', 64),
  amount: amountInputSchema,
  reference_id: referenceIdSchema,
  description: optionalString('description', 500),
});

const listTransfersQuery = z.object({
  ...paginationQueryShape,
  account_id: requiredString('account_id', 64).optional(),
  order: sortOrderSchema,
});

const transferParams = orgIdParams.extend({
  transferId: requiredString('transferId', 64),
});

type TransferListRow = TransferRow & {
  from_account_name: string;
  from_account_code: string;
  to_account_name: string;
  to_account_code: string;
  created_by_name: string | null;
};

function serializeTransfer(row: TransferListRow | TransferRow) {
  const enriched = row as TransferListRow;
  return {
    id: row.id,
    organization_id: row.org_id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
    ...(enriched.from_account_name === undefined
      ? {}
      : {
          from_account_name: enriched.from_account_name,
          from_account_code: enriched.from_account_code,
          to_account_name: enriched.to_account_name,
          to_account_code: enriched.to_account_code,
          created_by_name: enriched.created_by_name,
        }),
    amount: toMajorUnits(row.amount_minor),
    amount_minor: row.amount_minor,
    currency: row.currency,
    reference_id: row.reference_id,
    description: row.description,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export const transfersRouter = Router({ mergeParams: true });

transfersRouter.use(authenticate, validateParams(orgIdParams), resolveOrgContext);

transfersRouter.get(
  '/',
  requirePermission('transfer:read'),
  validateQuery(listTransfersQuery),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const query = req.query as unknown as z.infer<typeof listTransfersQuery>;
    const page = parsePagination(req.query as Record<string, unknown>);
    const db = getDb();

    const where = ['t.org_id = @orgId'];
    const params: Record<string, unknown> = { orgId: org.id };
    if (query.account_id) {
      where.push('(t.from_account_id = @accountId OR t.to_account_id = @accountId)');
      params.accountId = query.account_id;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const direction = query.order === 'asc' ? 'ASC' : 'DESC';

    const total =
      db
        .prepare<Record<string, unknown>, { count: number }>(
          `SELECT COUNT(*) AS count FROM transfers t ${whereSql}`,
        )
        .get(params)?.count ?? 0;

    const rows = db
      .prepare<Record<string, unknown>, TransferListRow>(
        `SELECT t.*,
                fa.name AS from_account_name, fa.code AS from_account_code,
                ta.name AS to_account_name,   ta.code AS to_account_code,
                u.name  AS created_by_name
           FROM transfers t
           JOIN accounts fa ON fa.id = t.from_account_id
           JOIN accounts ta ON ta.id = t.to_account_id
           LEFT JOIN users u ON u.id = t.created_by
           ${whereSql}
          ORDER BY t.created_at ${direction}, t.id ${direction}
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: page.limit, offset: page.offset });

    res.json({
      data: rows.map(serializeTransfer),
      meta: { pagination: buildPageMeta(page, total) },
    });
  }),
);

/**
 * Bonus requirement: move money between two accounts. Both legs plus both balance
 * updates are written inside one transaction by `executeTransfer`, so a partial transfer
 * is not representable.
 */
transfersRouter.post(
  '/',
  requirePermission('transfer:create'),
  validateBody(createTransferSchema),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const auth = currentUser(req);
    const body = req.body as z.infer<typeof createTransferSchema>;
    const amountMinor = parsePositiveAmount(body.amount, 'amount');

    const result = executeTransfer(
      {
        orgId: org.id,
        fromAccountId: body.from_account_id,
        toAccountId: body.to_account_id,
        amountMinor,
        referenceId: body.reference_id,
        description: body.description ?? null,
        actorId: auth.userId,
      },
      (db) =>
        recordAudit(
          req,
          {
            action: 'transfer.executed',
            entityType: 'transfer',
            entityId: body.reference_id,
            metadata: {
              from_account_id: body.from_account_id,
              to_account_id: body.to_account_id,
              amount: formatMajorUnits(amountMinor),
            },
          },
          db,
        ),
    );

    res.status(201).json({
      data: {
        ...serializeTransfer(result.transfer),
        debit_transaction: serializeTransaction(result.debit),
        credit_transaction: serializeTransaction(result.credit),
        from_account: serializeAccount(result.from),
        to_account: serializeAccount(result.to),
      },
    });
  }),
);

transfersRouter.get(
  '/:transferId',
  requirePermission('transfer:read'),
  validateParams(transferParams),
  asyncHandler((req, res) => {
    const org = orgContext(req);
    const { transferId } = req.params as z.infer<typeof transferParams>;
    const db = getDb();

    const transfer = db
      .prepare<[string, string], TransferRow>(
        'SELECT * FROM transfers WHERE org_id = ? AND id = ?',
      )
      .get(org.id, transferId);
    if (!transfer) {
      throw AppError.notFound(
        'TRANSFER_NOT_FOUND',
        `No transfer exists with id "${transferId}" in this organization`,
      );
    }

    const legs = db
      .prepare<[string], Parameters<typeof serializeTransaction>[0]>(
        'SELECT * FROM transactions WHERE transfer_id = ? ORDER BY type ASC',
      )
      .all(transfer.id);

    res.json({
      data: {
        ...serializeTransfer(transfer),
        legs: legs.map(serializeTransaction),
      },
    });
  }),
);

const immutable = asyncHandler(() => {
  throw AppError.methodNotAllowed(
    'TRANSFER_IMMUTABLE',
    'Transfers are immutable: reverse one with a new transfer in the opposite direction.',
  );
});

transfersRouter.put('/:transferId', immutable);
transfersRouter.patch('/:transferId', immutable);
transfersRouter.delete('/:transferId', immutable);
