import {
  ArrowLeftRight,
  Banknote,
  Plus,
  ReceiptText,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActivityHeatmap } from '../components/charts/ActivityHeatmap';
import { AccountMatrixChart } from '../components/charts/AccountMatrixChart';
import { BalanceDistributionChart } from '../components/charts/BalanceDistributionChart';
import { BalanceTrendChart } from '../components/charts/BalanceTrendChart';
import { CashflowChart } from '../components/charts/CashflowChart';
import { Sparkline } from '../components/charts/primitives';
import { TopAccountsChart } from '../components/charts/TopAccountsChart';
import { TypeDonutChart } from '../components/charts/TypeDonutChart';
import { NewTransactionModal, NewTransferModal } from '../components/forms';
import { StatTile } from '../components/StatTile';
import {
  Alert,
  Badge,
  Button,
  Card,
  SectionHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import {
  useAccountMatrix,
  useActivityHeatmap,
  useBalanceDistribution,
  useCashflow,
  useLedgerIntegrity,
  useOverview,
  useTopAccounts,
  useTransactions,
  useTypeSplit,
} from '../hooks/queries';
import { count, money, moneyCompact, relativeTime } from '../lib/format';
import { CREDIT_COLOR, DEBIT_COLOR, SERIES } from '../lib/viz';

export function DashboardPage() {
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const currency = organization?.currency ?? 'INR';

  const [days, setDays] = useState(30);
  const [txModal, setTxModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);

  const overview = useOverview(orgId);
  const cashflow = useCashflow(orgId, days);
  const distribution = useBalanceDistribution(orgId);
  const typeSplit = useTypeSplit(orgId);
  const matrix = useAccountMatrix(orgId);
  const heatmap = useActivityHeatmap(orgId, Math.max(days, 14));
  const topAccounts = useTopAccounts(orgId);
  const integrity = useLedgerIntegrity(orgId);
  const recent = useTransactions(orgId, { limit: 8 }, can('transaction:read'));

  const stats = overview.data;
  const netFlow = stats?.last_7_days.net_flow ?? 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-3">{organization?.name}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">
            Ledger overview
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Balances derived from {count(stats?.transactions.total)} immutable entries across{' '}
            {count(stats?.accounts.total)} accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('transaction:create') ? (
            <Button variant="primary" onClick={() => setTxModal(true)} icon={<Plus className="size-4" />}>
              Post transaction
            </Button>
          ) : null}
          {can('transfer:create') ? (
            <Button onClick={() => setTransferModal(true)} icon={<ArrowLeftRight className="size-4" />}>
              Transfer
            </Button>
          ) : null}
        </div>
      </div>

      {integrity.data && !integrity.data.consistent ? (
        <div className="mb-5">
          <Alert tone="critical" title="Ledger drift detected">
            {integrity.data.mismatches.length} account(s) have a stored balance that no longer
            matches their transaction history. This should never happen — check the audit trail.
          </Alert>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total balance"
          loading={overview.isLoading}
          value={money(stats?.balances.total, currency)}
          hint={`Largest account holds ${moneyCompact(stats?.balances.largest_account_balance, currency)}`}
          icon={<Banknote className="size-4" />}
          accent={SERIES[0]}
          footer={
            cashflow.data ? (
              <Sparkline
                data={cashflow.data.map((point) => ({
                  value: point.cumulative_balance,
                }))}
                color={SERIES[0]}
              />
            ) : (
              <Skeleton className="h-[34px] w-full" />
            )
          }
        />
        <StatTile
          label="Net flow (7 days)"
          loading={overview.isLoading}
          value={money(Math.abs(netFlow), currency)}
          delta={{
            value: netFlow === 0 ? 'flat' : netFlow > 0 ? 'inflow' : 'outflow',
            direction: netFlow === 0 ? 'flat' : netFlow > 0 ? 'up' : 'down',
            label: `${count(stats?.last_7_days.transactions)} entries`,
          }}
          icon={netFlow >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          accent={netFlow >= 0 ? CREDIT_COLOR : DEBIT_COLOR}
        />
        <StatTile
          label="Credited all time"
          loading={overview.isLoading}
          value={money(stats?.transactions.total_credit, currency)}
          hint={`${count(stats?.transactions.credits)} credit entries`}
          icon={<TrendingUp className="size-4" />}
          accent={CREDIT_COLOR}
        />
        <StatTile
          label="Debited all time"
          loading={overview.isLoading}
          value={money(stats?.transactions.total_debit, currency)}
          hint={`${count(stats?.transactions.debits)} debit entries`}
          icon={<TrendingDown className="size-4" />}
          accent={DEBIT_COLOR}
        />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Accounts"
          loading={overview.isLoading}
          value={count(stats?.accounts.total)}
          hint={`${stats?.accounts.active ?? 0} active · ${stats?.accounts.frozen ?? 0} frozen · ${stats?.accounts.closed ?? 0} closed`}
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="Transactions"
          loading={overview.isLoading}
          value={count(stats?.transactions.total)}
          hint={`Average ${moneyCompact(stats?.transactions.average_amount, currency)} · largest ${moneyCompact(stats?.transactions.largest_amount, currency)}`}
          icon={<ReceiptText className="size-4" />}
        />
        <StatTile
          label="Transfers"
          loading={overview.isLoading}
          value={count(stats?.transfers.total)}
          hint="Each writes a linked debit and credit pair"
          icon={<ArrowLeftRight className="size-4" />}
        />
        <StatTile
          label="Ledger integrity"
          loading={integrity.isLoading}
          value={
            integrity.data?.consistent ? (
              <span className="text-[#6ee06e]">Balanced</span>
            ) : (
              <span className="text-[#ff8f8f]">Drift</span>
            )
          }
          hint={`${count(integrity.data?.checked_accounts)} accounts re-derived from their entries`}
          icon={<ShieldCheck className="size-4" />}
        />
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-3">
        <CashflowChart
          data={cashflow.data}
          currency={currency}
          loading={cashflow.isLoading}
          days={days}
          onDaysChange={setDays}
        />
        <BalanceTrendChart
          data={cashflow.data}
          currency={currency}
          loading={cashflow.isLoading}
          days={days}
        />
        <TypeDonutChart
          data={typeSplit.data?.data}
          totalAmount={typeSplit.data?.meta?.total_amount}
          currency={currency}
          loading={typeSplit.isLoading}
        />
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <BalanceDistributionChart
          data={distribution.data?.data}
          totalBalance={distribution.data?.meta?.total_balance}
          currency={currency}
          loading={distribution.isLoading}
        />
        <AccountMatrixChart data={matrix.data} currency={currency} loading={matrix.isLoading} />
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <TopAccountsChart data={topAccounts.data} currency={currency} loading={topAccounts.isLoading} />
        <ActivityHeatmap
          data={heatmap.data}
          currency={currency}
          loading={heatmap.isLoading}
          days={Math.max(days, 14)}
        />
      </div>

      {can('transaction:read') ? (
        <Card>
          <SectionHeader
            title="Latest entries"
            subtitle="Newest first, straight from the ledger"
            actions={
              <Link to="/transactions">
                <Button size="sm" variant="ghost">
                  View all
                </Button>
              </Link>
            }
          />
          {recent.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Account</Th>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                  <Th align="right">When</Th>
                </tr>
              </thead>
              <tbody>
                {(recent.data?.data ?? []).map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-surface-2">
                    <Td className="font-mono text-[12px] text-ink">{transaction.reference_id}</Td>
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
                    <Td align="right" title={transaction.created_at}>
                      {relativeTime(transaction.created_at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2 text-sm text-ink-3">
            <Users className="size-4" />
            Your role does not include ledger read access.
          </div>
        </Card>
      )}

      <NewTransactionModal open={txModal} onClose={() => setTxModal(false)} orgId={orgId} />
      <NewTransferModal open={transferModal} onClose={() => setTransferModal(false)} orgId={orgId} />
    </>
  );
}
