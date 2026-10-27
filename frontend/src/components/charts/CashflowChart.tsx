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
import { AXIS_PROPS, CREDIT_COLOR, DEBIT_COLOR, GRID_PROPS, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, ChartLegend, TooltipCard } from './primitives';

/**
 * Daily money in versus money out. Both series are amounts in the same currency, so
 * they share one y-axis — the cumulative balance, which has a different scale, lives
 * in its own chart rather than on a second axis.
 */
export function CashflowChart({
  data,
  currency,
  loading,
  days,
  onDaysChange,
}: {
  data: CashflowPoint[] | undefined;
  currency: string;
  loading: boolean;
  days: number;
  onDaysChange: (days: number) => void;
}) {
  const points = data ?? [];
  const isEmpty = points.every((point) => point.credit === 0 && point.debit === 0);

  return (
    <ChartFrame
      title="Cash flow"
      subtitle={`Credits and debits per day, last ${days} days (UTC)`}
      height={280}
      loading={loading}
      isEmpty={!loading && isEmpty}
      legend={
        <ChartLegend
          items={[
            { label: 'Credit (money in)', color: CREDIT_COLOR },
            { label: 'Debit (money out)', color: DEBIT_COLOR },
          ]}
        />
      }
      actions={<RangeToggle value={days} onChange={onDaysChange} />}
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Credit</Th>
              <Th align="right">Debit</Th>
              <Th align="right">Net</Th>
              <Th align="right">Entries</Th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <Td>{dayLabel(point.date)}</Td>
                <Td align="right" className="tabular">
                  {money(point.credit, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {money(point.debit, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {money(point.net, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {point.transaction_count}
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
            <linearGradient id="creditFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CREDIT_COLOR} stopOpacity={0.34} />
              <stop offset="100%" stopColor={CREDIT_COLOR} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="debitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={DEBIT_COLOR} stopOpacity={0.3} />
              <stop offset="100%" stopColor={DEBIT_COLOR} stopOpacity={0.02} />
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
                    { label: 'Credit', value: money(point.credit, currency), color: CREDIT_COLOR },
                    { label: 'Debit', value: money(point.debit, currency), color: DEBIT_COLOR },
                    { label: 'Net', value: money(point.net, currency) },
                    { label: 'Entries', value: String(point.transaction_count) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="credit"
            name="Credit"
            stroke={CREDIT_COLOR}
            strokeWidth={2}
            fill="url(#creditFill)"
            activeDot={{ r: 4, strokeWidth: 2, stroke: VIZ.surface }}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="debit"
            name="Debit"
            stroke={DEBIT_COLOR}
            strokeWidth={2}
            fill="url(#debitFill)"
            activeDot={{ r: 4, strokeWidth: 2, stroke: VIZ.surface }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

const RANGES = [7, 30, 90] as const;

export function RangeToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-hairline bg-surface-2 p-0.5">
      {RANGES.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          aria-pressed={value === range}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            value === range ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {range}d
        </button>
      ))}
    </div>
  );
}
