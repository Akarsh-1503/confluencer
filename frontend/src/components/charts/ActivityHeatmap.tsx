import { useMemo, useState } from 'react';
import { count, money, WEEKDAYS } from '../../lib/format';
import type { HeatmapBucket } from '../../lib/types';
import { heatColor, VIZ } from '../../lib/viz';
import { Td, Th } from '../ui';
import { ChartFrame, TooltipCard } from './primitives';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * When the ledger is busy. Density is a magnitude, so cells use the single blue hue:
 * an empty hour recedes into the surface and a busy hour reads brightest. Hovering a
 * cell gives the exact numbers, and the table view lists every non-empty bucket.
 */
export function ActivityHeatmap({
  data,
  currency,
  loading,
  days,
}: {
  data: HeatmapBucket[] | undefined;
  currency: string;
  loading: boolean;
  days: number;
}) {
  const [hovered, setHovered] = useState<HeatmapBucket | null>(null);

  const { grid, max, filled } = useMemo(() => {
    const lookup = new Map<string, HeatmapBucket>();
    let maximum = 0;
    for (const bucket of data ?? []) {
      lookup.set(`${bucket.weekday}:${bucket.hour}`, bucket);
      maximum = Math.max(maximum, bucket.count);
    }
    return {
      grid: lookup,
      max: maximum,
      filled: (data ?? []).slice().sort((a, b) => b.count - a.count),
    };
  }, [data]);

  return (
    <ChartFrame
      title="Activity heatmap"
      subtitle={`Entries by weekday and hour (UTC), last ${days} days`}
      height={240}
      loading={loading}
      isEmpty={!loading && (data ?? []).length === 0}
      legend={
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span>Quiet</span>
          <div className="flex items-center gap-[2px]">
            {[0, 1, 2, 3, 4, 5, 6].map((step) => (
              <span
                key={step}
                className="inline-block size-3 rounded-[2px]"
                style={{ background: step === 0 ? VIZ.surface2 : heatColor(step, 6) }}
              />
            ))}
          </div>
          <span>Busy ({max} max)</span>
        </div>
      }
      table={
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Hour (UTC)</Th>
              <Th align="right">Entries</Th>
              <Th align="right">Value</Th>
            </tr>
          </thead>
          <tbody>
            {filled.map((bucket) => (
              <tr key={`${bucket.weekday}-${bucket.hour}`}>
                <Td>{WEEKDAYS[bucket.weekday]}</Td>
                <Td className="tabular">{String(bucket.hour).padStart(2, '0')}:00</Td>
                <Td align="right" className="tabular">
                  {count(bucket.count)}
                </Td>
                <Td align="right" className="tabular">
                  {money(bucket.amount, currency)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="relative">
        <div className="flex gap-2">
          <div className="flex flex-col gap-[3px] pt-[18px]">
            {WEEKDAYS.map((day) => (
              <span key={day} className="h-[18px] w-8 text-[10px] leading-[18px] text-ink-3">
                {day}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex gap-[3px] pb-1">
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="w-[18px] shrink-0 text-center text-[9px] text-ink-3"
                  aria-hidden
                >
                  {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-[3px]">
              {WEEKDAYS.map((day, weekday) => (
                <div key={day} className="flex gap-[3px]">
                  {HOURS.map((hour) => {
                    const bucket = grid.get(`${weekday}:${hour}`);
                    const value = bucket?.count ?? 0;
                    return (
                      <button
                        key={hour}
                        type="button"
                        onMouseEnter={() =>
                          setHovered(bucket ?? { weekday, hour, count: 0, amount: 0 })
                        }
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(bucket ?? { weekday, hour, count: 0, amount: 0 })}
                        onBlur={() => setHovered(null)}
                        aria-label={`${day} ${String(hour).padStart(2, '0')}:00 — ${value} entries`}
                        className="size-[18px] shrink-0 rounded-[3px] transition-transform hover:scale-125"
                        style={{
                          background: value === 0 ? VIZ.surface2 : heatColor(value, max),
                          boxShadow: value === 0 ? 'none' : `0 0 0 1px ${VIZ.surface}`,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {hovered ? (
          <div className="pointer-events-none absolute right-0 top-0">
            <TooltipCard
              heading={`${WEEKDAYS[hovered.weekday]} ${String(hovered.hour).padStart(2, '0')}:00 UTC`}
              rows={[
                { label: 'Entries', value: count(hovered.count) },
                { label: 'Value', value: money(hovered.amount, currency) },
              ]}
            />
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}
