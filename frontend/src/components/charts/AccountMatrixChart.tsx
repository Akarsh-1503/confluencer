import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { count, money, moneyCompact, relativeTime } from '../../lib/format';
import type { AccountMatrixPoint, AccountStatus } from '../../lib/types';
import { AXIS_PROPS, GRID_PROPS, SERIES, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, ChartLegend, TooltipCard } from './primitives';

/**
 * Spheres: one bubble per account. Position says how busy (x) and how large (y) the
 * account is; bubble area says how much value has flowed through it. Because every
 * bubble is compared against every other one, the series are limited to the three
 * palette slots that stay separable for colour-blind readers in all pairs, and each
 * one also carries its own shape so colour is never the only cue.
 */
const GROUPS: Array<{
  status: AccountStatus;
  label: string;
  color: string;
  shape: 'circle' | 'triangle' | 'diamond';
}> = [
  { status: 'active', label: 'Active', color: SERIES[0], shape: 'circle' },
  { status: 'frozen', label: 'Frozen', color: SERIES[1], shape: 'triangle' },
  { status: 'closed', label: 'Closed', color: SERIES[2], shape: 'diamond' },
];

export function AccountMatrixChart({
  data,
  currency,
  loading,
}: {
  data: AccountMatrixPoint[] | undefined;
  currency: string;
  loading: boolean;
}) {
  const points = data ?? [];
  const present = GROUPS.filter((group) =>
    points.some((point) => point.status === group.status),
  );

  return (
    <ChartFrame
      title="Account activity map"
      subtitle="Bubble position: entries vs balance. Bubble size: total value moved."
      height={320}
      loading={loading}
      isEmpty={!loading && points.length === 0}
      emptyLabel="Create an account to populate the map"
      legend={
        <ChartLegend
          items={present.map((group) => ({
            label: group.label,
            color: group.color,
            shape: group.shape,
          }))}
        />
      }
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Status</Th>
              <Th align="right">Entries</Th>
              <Th align="right">Balance</Th>
              <Th align="right">Throughput</Th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.account_id}>
                <Td>{point.name}</Td>
                <Td className="capitalize">{point.status}</Td>
                <Td align="right" className="tabular">
                  {count(point.transaction_count)}
                </Td>
                <Td align="right" className="tabular">
                  {money(point.balance, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {money(point.throughput, currency)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 18, bottom: 16, left: 4 }}>
          <CartesianGrid {...GRID_PROPS} vertical />
          <XAxis
            type="number"
            dataKey="transaction_count"
            name="Entries"
            {...AXIS_PROPS}
            axisLine={{ stroke: VIZ.axis }}
            allowDecimals={false}
            label={{
              value: 'Ledger entries',
              position: 'insideBottom',
              offset: -10,
              fill: VIZ.ink3,
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="balance"
            name="Balance"
            {...AXIS_PROPS}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) => moneyCompact(value, currency)}
          />
          <ZAxis type="number" dataKey="throughput" range={[80, 900]} name="Throughput" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: VIZ.ink3 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as AccountMatrixPoint;
              const group = GROUPS.find((item) => item.status === point.status);
              return (
                <TooltipCard
                  heading={point.name}
                  rows={[
                    { label: 'Status', value: group?.label ?? point.status, color: group?.color },
                    { label: 'Entries', value: count(point.transaction_count) },
                    { label: 'Balance', value: money(point.balance, currency) },
                    { label: 'Value moved', value: money(point.throughput, currency) },
                    { label: 'Last activity', value: relativeTime(point.last_activity_at) },
                  ]}
                />
              );
            }}
          />
          {present.map((group) => (
            <Scatter
              key={group.status}
              name={group.label}
              data={points.filter((point) => point.status === group.status)}
              fill={group.color}
              fillOpacity={0.55}
              stroke={group.color}
              strokeWidth={2}
              shape={group.shape}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
