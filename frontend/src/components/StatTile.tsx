import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from './ui';

/**
 * A single headline number. Per the data-viz rules this is deliberately *not* a chart:
 * one value needs a figure, not a plot. The optional delta is a text + icon pair so it
 * never relies on colour alone.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  icon,
  loading,
  accent,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; label?: string };
  icon?: ReactNode;
  loading?: boolean;
  accent?: string;
  footer?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="card p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-32" />
        <Skeleton className="mt-3 h-3 w-20" />
      </div>
    );
  }

  const DeltaIcon =
    delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus;

  return (
    <div className="card relative overflow-hidden p-4">
      {accent ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: accent }}
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
        {icon ? <span className="text-ink-3">{icon}</span> : null}
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-ink">{value}</p>
      {delta ? (
        <p
          className={clsx(
            'mt-2 inline-flex items-center gap-1 text-xs',
            delta.direction === 'up' && 'text-[#6ee06e]',
            delta.direction === 'down' && 'text-[#ff8f8f]',
            delta.direction === 'flat' && 'text-ink-3',
          )}
        >
          <DeltaIcon className="size-3.5" />
          <span className="tabular font-medium">{delta.value}</span>
          {delta.label ? <span className="text-ink-3">{delta.label}</span> : null}
        </p>
      ) : hint ? (
        <p className="mt-2 text-xs text-ink-3">{hint}</p>
      ) : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
