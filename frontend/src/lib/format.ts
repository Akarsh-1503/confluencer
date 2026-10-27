const currencyCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  const cached = currencyCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  });
  currencyCache.set(key, formatter);
  return formatter;
}

export function money(value: number | undefined | null, currency = 'INR'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return currencyFormatter(currency, false).format(value);
}

/** Short form for axis ticks and dense tiles: ₹12.4L style compaction. */
export function moneyCompact(value: number | undefined | null, currency = 'INR'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return currencyFormatter(currency, true).format(value);
}

export function signedMoney(value: number, currency = 'INR'): string {
  const formatted = money(Math.abs(value), currency);
  if (value === 0) return formatted;
  return `${value > 0 ? '+' : '−'}${formatted}`;
}

const numberFormatter = new Intl.NumberFormat('en-IN');
export const count = (value: number | undefined | null): string =>
  value === undefined || value === null ? '—' : numberFormatter.format(value);

export const percent = (value: number | undefined | null): string =>
  value === undefined || value === null ? '—' : `${value.toFixed(1)}%`;

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export const dateTime = (iso: string | null | undefined): string =>
  iso ? dateTimeFormatter.format(new Date(iso)) : '—';

export const dateOnly = (iso: string | null | undefined): string =>
  iso ? dateFormatter.format(new Date(iso)) : '—';

/** Axis-friendly day label: `14 Oct`. */
export const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** `transaction.created` -> `Transaction created`. */
export const humanise = (value: string): string => {
  const spaced = value.replace(/[._]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
