import { Search, Snowflake, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NewAccountModal } from '../components/forms';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Input,
  Pagination,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAccounts, useUpdateAccount } from '../hooks/queries';
import { count, dateOnly, money } from '../lib/format';

type SortField = 'created_at' | 'name' | 'balance';

export function AccountsPage() {
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<SortField>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [createOpen, setCreateOpen] = useState(false);

  const accounts = useAccounts(orgId, {
    page,
    limit,
    sort,
    order,
    ...(search ? { q: search } : {}),
    ...(status ? { status } : {}),
  });
  const updateAccount = useUpdateAccount(orgId);

  const rows = accounts.data?.data ?? [];
  const meta = accounts.data?.meta?.pagination;

  const toggleSort = (field: SortField) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setOrder(field === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const setAccountStatus = async (accountId: string, nextStatus: string, name: string) => {
    try {
      await updateAccount.mutateAsync({ accountId, status: nextStatus });
      toast.push({
        tone: 'good',
        title: `${name} is now ${nextStatus}`,
        body:
          nextStatus === 'frozen'
            ? 'New transactions on this account will be rejected.'
            : 'The account accepts transactions again.',
      });
    } catch (error) {
      toast.push({
        tone: 'critical',
        title: 'Could not change the account status',
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every balance here is the sum of that account's immutable ledger entries."
        actions={
          can('account:create') ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
              New account
            </Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or account code"
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-auto min-w-[150px]"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
            <option value="closed">Closed</option>
          </Select>
          <Select
            value={`${sort}:${order}`}
            onChange={(event) => {
              const [nextSort, nextOrder] = event.target.value.split(':');
              setSort(nextSort as SortField);
              setOrder(nextOrder as 'asc' | 'desc');
              setPage(1);
            }}
            className="w-auto min-w-[190px]"
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="balance:desc">Balance (high to low)</option>
            <option value="balance:asc">Balance (low to high)</option>
            <option value="name:asc">Name (A–Z)</option>
            <option value="name:desc">Name (Z–A)</option>
          </Select>
        </div>

        <div className="p-4">
          <ErrorNotice error={accounts.error} className="mb-3" />

          {accounts.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-6" />}
              title="No accounts match this view"
              description={
                search || status
                  ? 'Clear the filters to see every account in this organization.'
                  : 'Create the first account to start recording transactions.'
              }
              action={
                can('account:create') ? (
                  <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                    New account
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th onClick={() => toggleSort('name')} sorted={sort === 'name' && order}>
                      Account
                    </Th>
                    <Th>Code</Th>
                    <Th>Status</Th>
                    <Th align="right" onClick={() => toggleSort('balance')} sorted={sort === 'balance' && order}>
                      Balance
                    </Th>
                    <Th align="right">Entries</Th>
                    <Th
                      align="right"
                      onClick={() => toggleSort('created_at')}
                      sorted={sort === 'created_at' && order}
                    >
                      Opened
                    </Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => (
                    <tr key={account.id} className="hover:bg-surface-2">
                      <Td>
                        <Link
                          to={`/accounts/${account.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {account.name}
                        </Link>
                        {account.holder_email ? (
                          <span className="block text-[11px] text-ink-3">{account.holder_email}</span>
                        ) : null}
                      </Td>
                      <Td className="font-mono text-[12px]">{account.code}</Td>
                      <Td>
                        <StatusPill status={account.status} />
                      </Td>
                      <Td align="right" className="tabular font-medium text-ink">
                        {money(account.balance, account.currency)}
                      </Td>
                      <Td align="right" className="tabular">
                        {count(account.transaction_count ?? 0)}
                      </Td>
                      <Td align="right">{dateOnly(account.created_at)}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link to={`/accounts/${account.id}`}>
                            <Button size="sm" variant="ghost">
                              Ledger
                            </Button>
                          </Link>
                          {can('account:update') && account.status !== 'closed' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Snowflake className="size-3.5" />}
                              loading={updateAccount.isPending}
                              onClick={() =>
                                setAccountStatus(
                                  account.id,
                                  account.status === 'frozen' ? 'active' : 'frozen',
                                  account.name,
                                )
                              }
                            >
                              {account.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                            </Button>
                          ) : null}
                        </div>
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
        </div>
      </Card>

      <NewAccountModal open={createOpen} onClose={() => setCreateOpen(false)} orgId={orgId} />
    </>
  );
}
