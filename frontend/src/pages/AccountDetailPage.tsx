import { ArrowLeft, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sparkline } from '../components/charts/primitives';
import { NewTransactionModal } from '../components/forms';
import { StatTile } from '../components/StatTile';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAccount, useAccountTransactions, useUpdateAccount } from '../hooks/queries';
import { count, dateTime, money } from '../lib/format';
import { CREDIT_COLOR, DEBIT_COLOR, SERIES } from '../lib/viz';

export function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const currency = organization?.currency ?? 'INR';
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [txOpen, setTxOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const account = useAccount(orgId, accountId);
  const ledger = useAccountTransactions(orgId, accountId, { page, limit });
  const updateAccount = useUpdateAccount(orgId);

  const rows = ledger.data?.data ?? [];
  const meta = ledger.data?.meta?.pagination;
  const totals = ledger.data?.meta?.totals;

  // Oldest-first copy of the current page, so the sparkline reads left to right.
  const trend = [...rows].reverse().map((row) => ({ value: row.balance_after }));

  if (account.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (account.error || !account.data) {
    return (
      <>
        <ErrorNotice error={account.error} className="mb-4" />
        <Link to="/accounts">
          <Button icon={<ArrowLeft className="size-4" />}>Back to accounts</Button>
        </Link>
      </>
    );
  }

  const data = account.data;

  return (
    <>
      <div className="mb-6">
        <Link
          to="/accounts"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          All accounts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.name}</h1>
              <StatusPill status={data.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              <span className="font-mono text-[12px]">{data.code}</span>
              <span>Opened {dateTime(data.created_at)}</span>
              {data.holder_email ? <span>{data.holder_email}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can('account:update') ? (
              <Button onClick={() => setEditOpen(true)} icon={<Pencil className="size-4" />}>
                Edit account
              </Button>
            ) : null}
            {can('transaction:create') && data.status === 'active' ? (
              <Button variant="primary" onClick={() => setTxOpen(true)} icon={<Plus className="size-4" />}>
                Post transaction
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Current balance"
          value={money(data.balance, data.currency)}
          hint={`${count(data.transaction_count ?? meta?.total_records ?? 0)} ledger entries`}
          accent={SERIES[0]}
          footer={trend.length > 1 ? <Sparkline data={trend} color={SERIES[0]} /> : undefined}
        />
        <StatTile
          label="Credited (this page)"
          value={money(totals?.total_credit, currency)}
          hint={`${count(totals?.credit_count)} entries`}
          accent={CREDIT_COLOR}
        />
        <StatTile
          label="Debited (this page)"
          value={money(totals?.total_debit, currency)}
          hint={`${count(totals?.debit_count)} entries`}
          accent={DEBIT_COLOR}
        />
        <StatTile
          label="Balance check"
          value={<span className="text-[#6ee06e]">Derived</span>}
          hint="Balance equals the sum of this account's entries"
          icon={<ShieldCheck className="size-4" />}
        />
      </div>

      <Card>
        <ErrorNotice error={ledger.error} className="mb-3" />
        {ledger.isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No entries on this account yet"
            description="Post a credit to fund it, then debits become possible."
            action={
              can('transaction:create') ? (
                <Button size="sm" variant="primary" onClick={() => setTxOpen(true)}>
                  Post the first entry
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
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                  <Th>Description</Th>
                  <Th>Counterparty</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap">{dateTime(transaction.created_at)}</Td>
                    <Td className="font-mono text-[12px] text-ink">{transaction.reference_id}</Td>
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
                    <Td className="max-w-[240px] truncate" title={transaction.description ?? ''}>
                      {transaction.description ?? '—'}
                    </Td>
                    <Td>
                      {transaction.counterparty_account_id ? (
                        <Link
                          to={`/accounts/${transaction.counterparty_account_id}`}
                          className="hover:text-ink hover:underline"
                        >
                          {transaction.counterparty_account_name ?? 'Transfer'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
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
      </Card>

      <NewTransactionModal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        orgId={orgId}
        defaultAccountId={data.id}
      />

      <EditAccountModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{ id: data.id, name: data.name, status: data.status, balance: data.balance }}
        onSave={async (patch) => {
          try {
            await updateAccount.mutateAsync({ accountId: data.id, ...patch });
            toast.push({ tone: 'good', title: 'Account updated' });
            setEditOpen(false);
          } catch (error) {
            toast.push({
              tone: 'critical',
              title: 'Update rejected',
              body: error instanceof Error ? error.message : undefined,
            });
          }
        }}
        saving={updateAccount.isPending}
      />
    </>
  );
}

function EditAccountModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: { id: string; name: string; status: string; balance: number };
  onSave: (patch: { name?: string; status?: string }) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState(initial.status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit account"
      description="Metadata only — a balance can only change through a transaction or a transfer."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => onSave({ name, status })}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Account name" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field
          label="Status"
          hint={
            initial.balance !== 0
              ? 'An account must have a zero balance before it can be closed.'
              : 'Frozen accounts reject new transactions.'
          }
        >
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
            <option value="closed" disabled={initial.balance !== 0}>
              Closed {initial.balance !== 0 ? '(balance must be zero)' : ''}
            </option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
