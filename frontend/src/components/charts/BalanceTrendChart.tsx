import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dayLabel, money, moneyCompact } from '../../lib/format';
import type { CashflowPoint } from '../../lib/types';
import { AXIS_PROPS, GRID_PROPS, SERIES, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, TooltipCard } from './primitives';

/**
 * Closing balance per day for the whole organization. One series, so the title names
 * it and no legend box is needed.
 */
export function BalanceTrendChart({
  data,
  currency,
  loading,
  days,
}: {
  data: CashflowPoint[] | undefined;
  currency: string;
  loading: boolean;
  days: number;
}) {
  const points = data ?? [];

  return (
    <ChartFrame
      title="Closing balance"
      subtitle={`Sum of all account balances at the end of each day, last ${days} days`}
      height={280}
      loading={loading}
      isEmpty={!loading && points.length === 0}
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Closing balance</Th>
              <Th align="right">Net movement</Th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <Td>{dayLabel(point.date)}</Td>
                <Td align="right" className="tabular">
                  {money(point.cumulative_balance, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {money(point.net, currency)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.36} />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey="date"
            {...AXIS_PROPS}
            tickFormatter={dayLabel}
            minTickGap={24}
            axisLine={{ stroke: VIZ.axis }}
          />
          <YAxis
            {...AXIS_PROPS}
            axisLine={false}
            width={62}
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => moneyCompact(value, currency)}
          />
          <Tooltip
            cursor={{ stroke: VIZ.ink3, strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as CashflowPoint;
              return (
                <TooltipCard
                  heading={dayLabel(String(label))}
                  rows={[
                    {
                      label: 'Closing balance',
                      value: money(point.cumulative_balance, currency),
                      color: SERIES[0],
                    },
                    { label: 'Net movement', value: money(point.net, currency) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="cumulative_balance"
            name="Closing balance"
            stroke={SERIES[0]}
            strokeWidth={2}
            fill="url(#balanceFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: VIZ.surface }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
