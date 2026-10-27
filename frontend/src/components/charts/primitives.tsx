import clsx from 'clsx';
import { Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Skeleton } from '../ui';
import { VIZ } from '../../lib/viz';

/**
 * Every chart sits in this frame, which owns the title, the legend, the loading
 * state and the table view. The table view is the accessibility fallback: no chart
 * ships without a way to read the same numbers as text.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  actions,
  loading,
  isEmpty,
  emptyLabel = 'No activity in this window yet',
  height = 260,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  isEmpty?: boolean;
  emptyLabel?: string;
  height?: number;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className={clsx('card flex flex-col p-5', className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table ? (
            <button
              onClick={() => setShowTable((value) => !value)}
              aria-pressed={showTable}
              title={showTable ? 'Show chart' : 'Show the numbers as a table'}
              className={clsx(
                'rounded-md border border-hairline p-1.5 transition-colors',
                showTable ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-ink-3 hover:text-ink',
              )}
            >
              <Table2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      {legend && !showTable ? <div className="mb-3">{legend}</div> : null}

      <div className="flex-1" style={{ minHeight: height }}>
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-hairline text-xs text-ink-3">
            {emptyLabel}
          </div>
        ) : showTable && table ? (
          <div className="max-h-[320px] overflow-auto">{table}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Legend swatches. Identity is never carried by colour alone — labels are always on. */
export function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string; shape?: 'square' | 'circle' | 'triangle' | 'diamond' }>;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span
            aria-hidden
            className={clsx(
              'inline-block size-2.5 shrink-0',
              item.shape === 'circle' && 'rounded-full',
              item.shape === 'diamond' && 'rotate-45',
              (item.shape === 'square' || !item.shape) && 'rounded-[2px]',
            )}
            style={{
              background: item.color,
              ...(item.shape === 'triangle'
                ? {
                    background: 'transparent',
                    width: 0,
                    height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderBottom: `9px solid ${item.color}`,
                  }
                : {}),
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export type TooltipRow = { label: string; value: string; color?: string };

/** Shared tooltip surface. Values wear ink tokens; the swatch carries identity. */
export function TooltipCard({ heading, rows }: { heading: string; rows: TooltipRow[] }) {
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ background: VIZ.surface2, borderColor: VIZ.hairline }}
    >
      <p className="mb-1.5 font-semibold text-ink">{heading}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-3">
              {row.color ? (
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: row.color }}
                />
              ) : null}
              {row.label}
            </span>
            <span className="tabular font-medium text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tiny single-series area used inside tiles and table rows. */
export function Sparkline({
  data,
  dataKey = 'value',
  color = VIZ.ink2,
  height = 34,
}: {
  data: Array<Record<string, number | string>>;
  dataKey?: string;
  color?: string;
  height?: number;
}) {
  const gradientId = `spark-${dataKey}-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
