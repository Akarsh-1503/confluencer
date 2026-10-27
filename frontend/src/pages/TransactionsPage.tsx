import { Download, Filter, Plus, ReceiptText, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NewTransactionModal } from '../components/forms';
import { StatTile } from '../components/StatTile';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Pagination,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAccounts, useTransactions, type TransactionFilters } from '../hooks/queries';
import { downloadCsv } from '../lib/api';
import { count, dateTime, money } from '../lib/format';
import { CREDIT_COLOR, DEBIT_COLOR } from '../lib/viz';

const EMPTY: TransactionFilters = {
  account_id: '',
  type: '',
  reference_id: '',
  q: '',
  from: '',
  to: '',
  min_amount: '',
  max_amount: '',
  sort: 'created_at',
  order: 'desc',
};

export function TransactionsPage() {
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const currency = organization?.currency ?? 'INR';
  const toast = useToast();

  const [filters, setFilters] = useState<TransactionFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [showFilters, setShowFilters] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const accounts = useAccounts(orgId, { limit: 100, sort: 'name', order: 'asc' }, can('account:read'));

  // Only non-empty filters are sent, so the API never sees a blank parameter. The two
  // date inputs are days, so `from` becomes the start of that day and `to` its end.
  const query = useMemo(() => {
    const active: Record<string, unknown> = { page, limit };
    for (const [key, value] of Object.entries(filters)) {
      if (value === '' || value === undefined) continue;
      if (key === 'from') active[key] = `${String(value).slice(0, 10)}T00:00:00.000Z`;
      else if (key === 'to') active[key] = `${String(value).slice(0, 10)}T23:59:59.999Z`;
      else active[key] = value;
    }
    return active as TransactionFilters;
  }, [filters, page, limit]);

  const transactions = useTransactions(orgId, query);
  const rows = transactions.data?.data ?? [];
  const meta = transactions.data?.meta?.pagination;
  const totals = transactions.data?.meta?.totals;

  const update = (patch: Partial<TransactionFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== '' && value !== undefined && key !== 'sort' && key !== 'order',
  ).length;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const exportQuery: Record<string, string | number | undefined> = {};
      for (const [key, value] of Object.entries(query)) {
        if (key === 'page' || key === 'limit') continue;
        if (value !== '' && value !== undefined) exportQuery[key] = value as string;
      }
      await downloadCsv(
        `/organizations/${orgId}/transactions/export`,
        exportQuery,
        `transactions-${organization?.slug ?? 'ledger'}.csv`,
      );
      toast.push({ tone: 'good', title: 'Export downloaded' });
    } catch (error) {
      toast.push({
        tone: 'critical',
        title: 'Export failed',
        body: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Append-only ledger. Entries cannot be edited or deleted once written."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setShowFilters((value) => !value)}
              icon={<Filter className="size-4" />}
            >
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </Button>
            <Button onClick={exportCsv} loading={exporting} icon={<Download className="size-4" />}>
              Export CSV
            </Button>
            {can('transaction:create') ? (
              <Button
                variant="primary"
                onClick={() => setCreateOpen(true)}
                icon={<Plus className="size-4" />}
              >
                Post transaction
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Entries in view"
          loading={transactions.isLoading}
          value={count(meta?.total_records)}
          hint={`Page ${meta?.page ?? 1} of ${Math.max(meta?.total_pages ?? 1, 1)}`}
          icon={<ReceiptText className="size-4" />}
        />
        <StatTile
          label="Credited (filtered)"
          loading={transactions.isLoading}
          value={money(totals?.total_credit, currency)}
          hint={`${count(totals?.credit_count)} entries`}
          accent={CREDIT_COLOR}
        />
        <StatTile
          label="Debited (filtered)"
          loading={transactions.isLoading}
          value={money(totals?.total_debit, currency)}
          hint={`${count(totals?.debit_count)} entries`}
          accent={DEBIT_COLOR}
        />
        <StatTile
          label="Net (filtered)"
          loading={transactions.isLoading}
          value={money(totals?.net_amount, currency)}
          hint="Credits minus debits in this view"
        />
      </div>

      {showFilters ? (
        <Card className="mb-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <Field label="Account">
              <Select
                value={filters.account_id ?? ''}
                onChange={(event) => update({ account_id: event.target.value })}
              >
                <option value="">All accounts</option>
                {(accounts.data?.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={filters.type ?? ''} onChange={(event) => update({ type: event.target.value })}>
                <option value="">Credit and debit</option>
                <option value="credit">Credit only</option>
                <option value="debit">Debit only</option>
              </Select>
            </Field>
            <Field label="Search description or reference">
              <Input
                value={filters.q ?? ''}
                onChange={(event) => update({ q: event.target.value })}
                placeholder="payout, INV-204…"
              />
            </Field>
            <Field label="Exact reference ID">
              <Input
                value={filters.reference_id ?? ''}
                onChange={(event) => update({ reference_id: event.target.value })}
                placeholder="TXN-001"
              />
            </Field>
            <Field label="From date">
              <Input
                type="date"
                value={(filters.from ?? '').slice(0, 10)}
                onChange={(event) => update({ from: event.target.value })}
              />
            </Field>
            <Field label="To date">
              <Input
                type="date"
                value={(filters.to ?? '').slice(0, 10)}
                onChange={(event) => update({ to: event.target.value })}
              />
            </Field>
            <Field label={`Min amount (${currency})`}>
              <Input
                inputMode="decimal"
                value={filters.min_amount ?? ''}
                onChange={(event) => update({ min_amount: event.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label={`Max amount (${currency})`}>
              <Input
                inputMode="decimal"
                value={filters.max_amount ?? ''}
                onChange={(event) => update({ max_amount: event.target.value })}
                placeholder="100000.00"
              />
            </Field>
            <Field label="Sort">
              <Select
                value={`${filters.sort}:${filters.order}`}
                onChange={(event) => {
                  const [sort, order] = event.target.value.split(':');
                  update({ sort, order });
                }}
              >
                <option value="created_at:desc">Newest first</option>
                <option value="created_at:asc">Oldest first</option>
                <option value="amount:desc">Amount (high to low)</option>
                <option value="amount:asc">Amount (low to high)</option>
              </Select>
            </Field>
            <Field label="Only transfer legs">
              <Select
                value={filters.transfers_only ? 'true' : ''}
                onChange={(event) =>
                  update({ transfers_only: event.target.value === 'true' ? true : undefined })
                }
              >
                <option value="">Everything</option>
                <option value="true">Transfer legs only</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY);
                  setPage(1);
                }}
                icon={<RotateCcw className="size-4" />}
              >
                Reset filters
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <ErrorNotice error={transactions.error} className="mb-3" />

        {transactions.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-6" />}
            title="No transactions match these filters"
            description="Widen the date range or clear the filters to see more of the ledger."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Reference</Th>
                  <Th>Account</Th>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                  <Th>Description</Th>
                  <Th>Posted by</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap">{dateTime(transaction.created_at)}</Td>
                    <Td className="font-mono text-[12px] text-ink">
                      {transaction.reference_id}
                      {transaction.transfer_id ? (
                        <Badge tone="neutral" className="ml-1.5">
                          transfer
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <Link
                        to={`/accounts/${transaction.account_id}`}
                        className="hover:text-ink hover:underline"
                      >
                        {transaction.account_name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={transaction.type === 'credit' ? 'info' : 'serious'}>
                        {transaction.type === 'credit' ? 'Credit' : 'Debit'}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular font-medium text-ink">
                      {transaction.type === 'credit' ? '+' : '−'}
                      {money(transaction.amount, currency)}
                    </Td>
                    <Td align="right" className="tabular">
                      {money(transaction.balance_after, currency)}
                    </Td>
                    <Td className="max-w-[260px] truncate" title={transaction.description ?? ''}>
                      {transaction.description ?? '—'}
                    </Td>
                    <Td>{transaction.created_by_name ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              meta={meta}
              onPageChange={setPage}
              onLimitChange={(value) => {
                setLimit(value);
                setPage(1);
              }}
            />
          </>
        )}

        <div className="mt-4">
          <Alert tone="info" title="Why there are no edit or delete buttons">
            Transactions are immutable by design. The API answers{' '}
            <code className="rounded bg-black/30 px-1">405 TRANSACTION_IMMUTABLE</code> to PUT,
            PATCH and DELETE, and the database blocks UPDATE and DELETE on the table with triggers.
            Corrections are made by posting a compensating entry.
          </Alert>
        </div>
      </Card>

      <NewTransactionModal open={createOpen} onClose={() => setCreateOpen(false)} orgId={orgId} />
    </>
  );
}
