import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { count, money } from '../../lib/format';
import type { TopAccount } from '../../lib/types';
import { AXIS_PROPS, SERIES, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, TooltipCard } from './primitives';

/**
 * Busiest accounts by number of ledger entries. One series, horizontal bars with
 * rounded data-ends anchored to the baseline, so the comparison is length only.
 */
export function TopAccountsChart({
  data,
  currency,
  loading,
}: {
  data: TopAccount[] | undefined;
  currency: string;
  loading: boolean;
}) {
  const rows = (data ?? []).filter((row) => row.transaction_count > 0);

  return (
    <ChartFrame
      title="Busiest accounts"
      subtitle="Ledger entries recorded per account"
      height={260}
      loading={loading}
      isEmpty={!loading && rows.length === 0}
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Entries</Th>
              <Th align="right">Credited</Th>
              <Th align="right">Debited</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.account_id}>
                <Td>{row.name}</Td>
                <Td align="right" className="tabular">
                  {count(row.transaction_count)}
                </Td>
                <Td align="right" className="tabular">
                  {money(row.total_credit, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {money(row.total_debit, currency)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 28, bottom: 0, left: 4 }}
          barCategoryGap={8}
        >
          <CartesianGrid {...AXIS_PROPS} stroke={VIZ.grid} strokeDasharray="2 6" horizontal={false} />
          <XAxis type="number" {...AXIS_PROPS} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            {...AXIS_PROPS}
            axisLine={false}
            width={132}
            tickFormatter={(value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as TopAccount;
              return (
                <TooltipCard
                  heading={row.name}
                  rows={[
                    { label: 'Entries', value: count(row.transaction_count), color: SERIES[0] },
                    { label: 'Credited', value: money(row.total_credit, currency) },
                    { label: 'Debited', value: money(row.total_debit, currency) },
                    { label: 'Balance', value: money(row.balance, currency) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="transaction_count"
            name="Entries"
            fill={SERIES[0]}
            radius={[0, 4, 4, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
