import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { count, money, percent } from '../../lib/format';
import type { TypeSplit } from '../../lib/types';
import { CREDIT_COLOR, DEBIT_COLOR, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, ChartLegend, TooltipCard } from './primitives';

/**
 * Credit versus debit as a share of total value moved. Two slices only, each directly
 * labelled, with a hero figure in the middle — the donut answers "which direction
 * dominates" at a glance.
 */
export function TypeDonutChart({
  data,
  totalAmount,
  currency,
  loading,
}: {
  data: TypeSplit[] | undefined;
  totalAmount: number | undefined;
  currency: string;
  loading: boolean;
}) {
  const slices = (data ?? []).filter((slice) => slice.amount > 0);
  const colorFor = (type: string) => (type === 'credit' ? CREDIT_COLOR : DEBIT_COLOR);

  return (
    <ChartFrame
      title="Credit vs debit"
      subtitle="Share of total value moved, all time"
      height={260}
      loading={loading}
      isEmpty={!loading && slices.length === 0}
      legend={
        <ChartLegend
          items={[
            { label: 'Credit', color: CREDIT_COLOR, shape: 'circle' },
            { label: 'Debit', color: DEBIT_COLOR, shape: 'circle' },
          ]}
        />
      }
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Type</Th>
              <Th align="right">Entries</Th>
              <Th align="right">Value</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((slice) => (
              <tr key={slice.type}>
                <Td className="capitalize">{slice.type}</Td>
                <Td align="right" className="tabular">
                  {count(slice.count)}
                </Td>
                <Td align="right" className="tabular">
                  {money(slice.amount, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {percent(slice.amount_share)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="relative h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="amount"
              nameKey="type"
              innerRadius="62%"
              outerRadius="88%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              stroke={VIZ.surface}
              strokeWidth={2}
            >
              {slices.map((slice) => (
                <Cell key={slice.type} fill={colorFor(slice.type)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const slice = payload[0]?.payload as TypeSplit;
                return (
                  <TooltipCard
                    heading={slice.type === 'credit' ? 'Credit' : 'Debit'}
                    rows={[
                      { label: 'Value', value: money(slice.amount, currency), color: colorFor(slice.type) },
                      { label: 'Entries', value: count(slice.count) },
                      { label: 'Share of value', value: percent(slice.amount_share) },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">Total moved</span>
          <span className="mt-0.5 text-lg font-semibold text-ink">
            {money(totalAmount ?? 0, currency)}
          </span>
          {slices.length === 2 ? (
            <span className="mt-1 text-[11px] text-ink-3">
              {percent(slices.find((slice) => slice.type === 'credit')?.amount_share ?? 0)} credit
            </span>
          ) : null}
        </div>
      </div>
    </ChartFrame>
  );
}
