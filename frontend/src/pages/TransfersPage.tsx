import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NewTransferModal } from '../components/forms';
import { StatTile } from '../components/StatTile';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Pagination,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAccounts, useTransfers } from '../hooks/queries';
import { count, dateTime, money } from '../lib/format';
import { SERIES } from '../lib/viz';

export function TransfersPage() {
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const currency = organization?.currency ?? 'INR';

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [accountId, setAccountId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const accounts = useAccounts(orgId, { limit: 100, sort: 'name', order: 'asc' }, can('account:read'));
  const transfers = useTransfers(orgId, { page, limit, ...(accountId ? { account_id: accountId } : {}) });

  const rows = transfers.data?.data ?? [];
  const meta = transfers.data?.meta?.pagination;
  const movedOnPage = rows.reduce((total, transfer) => total + transfer.amount, 0);

  return (
    <>
      <PageHeader
        title="Transfers"
        subtitle="Internal movements between two accounts of this organization."
        actions={
          can('transfer:create') ? (
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              icon={<ArrowLeftRight className="size-4" />}
            >
              New transfer
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Transfers"
          loading={transfers.isLoading}
          value={count(meta?.total_records)}
          hint="Each writes one debit and one credit"
          accent={SERIES[0]}
        />
        <StatTile
          label="Moved on this page"
          loading={transfers.isLoading}
          value={money(movedOnPage, currency)}
          hint="Internal movement does not change the organization total"
        />
        <StatTile
          label="Partial transfers"
          value="0"
          hint="Both legs share one database transaction, so a half transfer cannot exist"
        />
      </div>

      <Card>
        <div className="mb-4 max-w-xs">
          <Field label="Filter by account">
            <Select
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All accounts</option>
              {(accounts.data?.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <ErrorNotice error={transfers.error} className="mb-3" />

        {transfers.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="size-6" />}
            title="No transfers yet"
            description="Move money between two accounts to see it recorded here with both legs."
            action={
              can('transfer:create') ? (
                <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                  New transfer
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Reference</Th>
                  <Th>Route</Th>
                  <Th align="right">Amount</Th>
                  <Th>Description</Th>
                  <Th>Executed by</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap">{dateTime(transfer.created_at)}</Td>
                    <Td className="font-mono text-[12px] text-ink">{transfer.reference_id}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link
                          to={`/accounts/${transfer.from_account_id}`}
                          className="text-ink hover:underline"
                        >
                          {transfer.from_account_name ?? 'Source'}
                        </Link>
                        <ArrowRight className="size-3.5 text-ink-3" />
                        <Link
                          to={`/accounts/${transfer.to_account_id}`}
                          className="text-ink hover:underline"
                        >
                          {transfer.to_account_name ?? 'Destination'}
                        </Link>
                      </span>
                    </Td>
                    <Td align="right" className="tabular font-medium text-ink">
                      {money(transfer.amount, transfer.currency)}
                    </Td>
                    <Td className="max-w-[260px] truncate" title={transfer.description ?? ''}>
                      {transfer.description ?? '—'}
                    </Td>
                    <Td>{transfer.created_by_name ?? '—'}</Td>
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
          <Alert tone="info" title="How a transfer is kept atomic">
            The transfer header, the debit leg, the credit leg and both balance updates are written
            inside one SQLite transaction. If the source has insufficient balance — or any other
            step fails — the whole unit rolls back and neither account moves.
          </Alert>
        </div>
      </Card>

      <NewTransferModal open={createOpen} onClose={() => setCreateOpen(false)} orgId={orgId} />
    </>
  );
}
