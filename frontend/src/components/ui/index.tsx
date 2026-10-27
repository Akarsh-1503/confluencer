import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { ApiError } from '../../lib/api';
import type { Pagination as PaginationMeta } from '../../lib/types';

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx('card', padded && 'p-5', className)}>{children}</section>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-series-1 text-white hover:bg-[#2a78d6]',
        variant === 'secondary' &&
          'border border-hairline bg-surface-2 text-ink hover:bg-surface-3',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'border border-[#d03b3b]/40 bg-[#d03b3b]/10 text-[#ff8f8f] hover:bg-[#d03b3b]/20',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {required ? <span className="text-[#ff8f8f]">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-[#ff8f8f]">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const controlClass =
  'h-9 w-full rounded-lg border border-hairline bg-surface-2 px-3 text-[13px] text-ink placeholder:text-ink-3 focus:border-series-1 focus:outline-none';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(controlClass, className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...rest} className={clsx(controlClass, 'appearance-none pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...rest
}: InputHTMLAttributes<HTMLTextAreaElement> & { rows?: number }) {
  return (
    <textarea
      {...rest}
      className={clsx(
        'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-series-1 focus:outline-none',
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Status & feedback                                                           */
/* -------------------------------------------------------------------------- */

const TONE_CLASS = {
  neutral: 'border-hairline bg-surface-2 text-ink-2',
  good: 'border-[#0ca30c]/35 bg-[#0ca30c]/12 text-[#6ee06e]',
  warning: 'border-[#fab219]/35 bg-[#fab219]/12 text-[#ffcf6b]',
  serious: 'border-[#ec835a]/35 bg-[#ec835a]/12 text-[#f6a883]',
  critical: 'border-[#d03b3b]/35 bg-[#d03b3b]/12 text-[#ff8f8f]',
  info: 'border-[#3987e5]/35 bg-[#3987e5]/12 text-[#8ebdf4]',
} as const;

export type Tone = keyof typeof TONE_CLASS;

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Status is never colour alone: every tone ships with an icon and a label. */
export function StatusPill({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>
        Active
      </Badge>
    );
  }
  if (status === 'frozen') {
    return (
      <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>
        Frozen
      </Badge>
    );
  }
  if (status === 'closed') {
    return (
      <Badge tone="critical" icon={<X className="size-3" />}>
        Closed
      </Badge>
    );
  }
  return <Badge>{status}</Badge>;
}

const ROLE_TONE: Record<string, Tone> = {
  OWNER: 'info',
  ADMIN: 'info',
  EDITOR: 'neutral',
  AUDITOR: 'neutral',
  READER: 'neutral',
};

export function RolePill({ role }: { role: string }) {
  return (
    <Badge tone={ROLE_TONE[role] ?? 'neutral'} className="uppercase tracking-wide">
      {role}
    </Badge>
  );
}

export function Alert({
  tone = 'critical',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'info' ? Info : ShieldAlert;
  return (
    <div className={clsx('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]', TONE_CLASS[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={clsx(title && 'mt-0.5', 'break-words')}>{children}</div>
      </div>
    </div>
  );
}

/** Renders an API failure with its code, message and field details. */
export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Something went wrong';

  return (
    <div className={className}>
      <Alert tone="critical" title={apiError ? apiError.code : 'Request failed'}>
        <p>{message}</p>
        {apiError && apiError.details.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
            {apiError.details.map((detail, index) => (
              <li key={index}>
                {detail.field ? <span className="font-medium">{detail.field}: </span> : null}
                {detail.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Alert>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-ink-3">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-xs text-ink-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-lg', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin text-ink-3', className)} />;
}

/* -------------------------------------------------------------------------- */
/* Table & pagination                                                          */
/* -------------------------------------------------------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx('w-full border-collapse text-[13px]', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
  onClick,
  sorted,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  onClick?: () => void;
  sorted?: 'asc' | 'desc' | false;
}) {
  return (
    <th
      onClick={onClick}
      className={clsx(
        'border-b border-hairline px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        onClick && 'cursor-pointer select-none hover:text-ink-2',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sorted ? <span className="text-series-1">{sorted === 'asc' ? '↑' : '↓'}</span> : null}
      </span>
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
  title,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={clsx(
        'border-b border-hairline/60 px-3 py-2.5 text-ink-2',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Pagination({
  meta,
  onPageChange,
  onLimitChange,
}: {
  meta: PaginationMeta | undefined;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}) {
  if (!meta) return null;
  const from = meta.total_records === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total_records);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
      <p className="tabular">
        Showing <span className="text-ink-2">{from}</span>–<span className="text-ink-2">{to}</span> of{' '}
        <span className="text-ink-2">{meta.total_records}</span> records
      </p>
      <div className="flex items-center gap-2">
        {onLimitChange ? (
          <label className="flex items-center gap-1.5">
            <span>Rows</span>
            <select
              value={meta.limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="h-7 rounded-md border border-hairline bg-surface-2 px-1.5 text-xs text-ink"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={!meta.has_previous_page}
          icon={<ChevronLeft className="size-4" />}
          aria-label="Previous page"
        />
        <span className="tabular">
          Page {meta.page} / {Math.max(meta.total_pages, 1)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={!meta.has_next_page}
          icon={<ChevronRight className="size-4" />}
          aria-label="Next page"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 pt-[8vh] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'animate-rise card w-full p-0 shadow-2xl',
          width === 'lg' ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

type Toast = { id: number; tone: Tone; title: string; body?: string };

const ToastContext = createContext<{ push: (toast: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'animate-rise pointer-events-auto rounded-lg border px-3.5 py-3 text-[13px] shadow-xl backdrop-blur',
              TONE_CLASS[toast.tone],
            )}
          >
            <p className="font-semibold">{toast.title}</p>
            {toast.body ? <p className="mt-0.5 text-xs opacity-90">{toast.body}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
