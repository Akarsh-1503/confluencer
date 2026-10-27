import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { money, percent } from '../../lib/format';
import type { DistributionSlice } from '../../lib/types';
import { rampSlice, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, TooltipCard } from './primitives';

/**
 * Where the money sits. Share-of-total is a magnitude encoding, so the slices use the
 * single-hue sequential ramp ordered by size — the biggest holding is the brightest —
 * rather than eight categorical hues that no colour-blind reader could separate in a
 * pie. The accounts past the cut-off arrive from the API pre-folded into one "Other"
 * slice, which is why there is never a 9th generated colour.
 */
export function BalanceDistributionChart({
  data,
  totalBalance,
  currency,
  loading,
}: {
  data: DistributionSlice[] | undefined;
  totalBalance: number | undefined;
  currency: string;
  loading: boolean;
}) {
  const slices = (data ?? []).filter((slice) => slice.balance > 0);

  return (
    <ChartFrame
      title="Balance distribution"
      subtitle="Share of the organization's total balance by account"
      height={300}
      loading={loading}
      isEmpty={!loading && slices.length === 0}
      emptyLabel="No funded accounts yet"
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th align="right">Balance</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {slices.map((slice) => (
              <tr key={slice.account_id}>
                <Td>{slice.name}</Td>
                <Td align="right" className="tabular">
                  {money(slice.balance, currency)}
                </Td>
                <Td align="right" className="tabular">
                  {percent(slice.share)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="flex h-full flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative h-[220px] shrink-0 lg:h-full lg:w-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="balance"
                nameKey="name"
                innerRadius="52%"
                outerRadius="86%"
                paddingAngle={2}
                stroke={VIZ.surface}
                strokeWidth={2}
              >
                {slices.map((slice, index) => (
                  <Cell key={slice.account_id} fill={rampSlice(index, slices.length)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0]?.payload as DistributionSlice;
                  const index = slices.findIndex((item) => item.account_id === slice.account_id);
                  return (
                    <TooltipCard
                      heading={slice.name}
                      rows={[
                        {
                          label: 'Balance',
                          value: money(slice.balance, currency),
                          color: rampSlice(index, slices.length),
                        },
                        { label: 'Share', value: percent(slice.share) },
                        ...(slice.code === '—' ? [] : [{ label: 'Code', value: slice.code }]),
                      ]}
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] uppercase tracking-wide text-ink-3">Total</span>
            <span className="text-base font-semibold text-ink">
              {money(totalBalance ?? 0, currency)}
            </span>
          </div>
        </div>

        {/* Direct labels: the share is readable without hovering. */}
        <ul className="flex-1 space-y-1.5">
          {slices.map((slice, index) => (
            <li key={slice.account_id} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-[2px]"
                style={{ background: rampSlice(index, slices.length) }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-2" title={slice.name}>
                {slice.name}
              </span>
              <span className="tabular text-ink-3">{percent(slice.share)}</span>
              <span className="tabular w-24 text-right font-medium text-ink">
                {money(slice.balance, currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}
