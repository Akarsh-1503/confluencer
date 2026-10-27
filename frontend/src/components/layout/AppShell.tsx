import clsx from 'clsx';
import {
  ArrowLeftRight,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Grid2x2Check,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useHealth, useLedgerIntegrity } from '../../hooks/queries';
import { initials, money } from '../../lib/format';
import type { Permission } from '../../lib/types';
import { Badge, RolePill } from '../ui';

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  permission?: Permission;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { to: '/accounts', label: 'Accounts', icon: <Wallet className="size-4" />, permission: 'account:read' },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: <ReceiptText className="size-4" />,
    permission: 'transaction:read',
  },
  {
    to: '/transfers',
    label: 'Transfers',
    icon: <ArrowLeftRight className="size-4" />,
    permission: 'transfer:read',
  },
  {
    to: '/access',
    label: 'Access control',
    icon: <ShieldCheck className="size-4" />,
    permission: 'member:read',
  },
  {
    to: '/audit',
    label: 'Audit trail',
    icon: <ScrollText className="size-4" />,
    permission: 'audit:read',
  },
];

export function AppShell() {
  const { organization, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const visibleNav = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen bg-plane">
      <div className="flex">
        <aside
          className={clsx(
            'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-hairline bg-surface transition-transform lg:static lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-2.5 px-5 py-5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-series-1">
              <CircleDollarSign className="size-4.5 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-ink">Confluencr</p>
              <p className="text-[11px] leading-tight text-ink-3">Ledger console</p>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="ml-auto rounded-md p-1 text-ink-3 hover:text-ink lg:hidden"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 px-2.5">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                    isActive
                      ? 'bg-surface-3 font-medium text-ink'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          <LedgerHealth orgId={organization?.id} currency={organization?.currency ?? 'INR'} />
        </aside>

        {mobileOpen ? (
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <TopBar onMenu={() => setMobileOpen(true)} />
          <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, organization, logout } = useAuth();
  const health = useHealth();

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-plane/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </button>

        <OrgSwitcher />

        <div className="ml-auto flex items-center gap-3">
          <Badge
            tone={health.data?.status === 'ok' ? 'good' : 'critical'}
            icon={<Grid2x2Check className="size-3" />}
            className="hidden sm:inline-flex"
          >
            API {health.data?.status === 'ok' ? 'healthy' : 'unreachable'}
          </Badge>

          {organization ? <RolePill role={organization.role} /> : null}

          <div className="flex items-center gap-2 border-l border-hairline pl-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-ink-2">
              {user ? initials(user.name) : '—'}
            </span>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs font-medium text-ink">{user?.name}</p>
              <p className="truncate text-[11px] text-ink-3">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function OrgSwitcher() {
  const { organizations, organization, selectOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!organization) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink hover:bg-surface-2"
      >
        <Building2 className="size-4 text-ink-3" />
        <span className="max-w-[180px] truncate font-medium">{organization.name}</span>
        <ChevronDown className="size-3.5 text-ink-3" />
      </button>

      {open ? (
        <div className="animate-rise absolute left-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-lg border border-hairline bg-surface shadow-2xl">
          <p className="border-b border-hairline px-3 py-2 text-[11px] uppercase tracking-wide text-ink-3">
            Your organizations
          </p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {organizations.map((org) => (
              <li key={org.id}>
                <button
                  onClick={() => {
                    selectOrganization(org.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{org.name}</span>
                    <span className="block text-[11px] text-ink-3">
                      {org.role} · {org.account_count ?? 0} accounts ·{' '}
                      {money(org.total_balance ?? 0, org.currency)}
                    </span>
                  </span>
                  {org.id === organization.id ? (
                    <Check className="size-4 shrink-0 text-series-1" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live invariant check in the sidebar: the API re-derives every balance from the
 * transaction log and this reports whether stored balances still match.
 */
function LedgerHealth({ orgId, currency }: { orgId: string | undefined; currency: string }) {
  const integrity = useLedgerIntegrity(orgId ?? '');
  if (!orgId) return null;

  const consistent = integrity.data?.consistent;

  return (
    <div className="m-2.5 rounded-lg border border-hairline bg-surface-2 p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-3">Ledger integrity</p>
      <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium">
        {integrity.isLoading ? (
          <span className="text-ink-3">Checking…</span>
        ) : consistent ? (
          <>
            <Check className="size-3.5 text-[#6ee06e]" />
            <span className="text-[#6ee06e]">Balanced</span>
          </>
        ) : (
          <span className="text-[#ff8f8f]">Drift detected</span>
        )}
      </p>
      {integrity.data ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-3">
          {integrity.data.checked_accounts} accounts ·{' '}
          <span className="tabular">{money(integrity.data.total_derived_balance, currency)}</span>{' '}
          derived from the ledger
        </p>
      ) : null}
    </div>
  );
}
