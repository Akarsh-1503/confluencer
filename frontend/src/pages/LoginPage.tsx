import { CircleDollarSign, LogIn, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Button, Card, ErrorNotice, Field, Input } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'OWNER', email: 'owner@confluencr.test', can: 'Everything, including org settings' },
  { role: 'ADMIN', email: 'admin@confluencr.test', can: 'Accounts, members, audit trail' },
  { role: 'EDITOR', email: 'editor@confluencr.test', can: 'Post transactions and transfers' },
  { role: 'AUDITOR', email: 'auditor@confluencr.test', can: 'Read-only plus the audit trail' },
  { role: 'READER', email: 'reader@confluencr.test', can: 'Read-only' },
];

export function LoginPage() {
  const { status, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({
    name: '',
    email: 'owner@confluencr.test',
    password: 'Password123!',
    organization_name: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
          ...(form.organization_name ? { organization_name: form.organization_name } : {}),
        });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-plane px-4 py-10">
      <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="animate-rise">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-series-1">
              <CircleDollarSign className="size-5 text-white" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight text-ink">Confluencr Ledger</h1>
              <p className="text-xs text-ink-3">Accounts, transactions and transfers</p>
            </div>
          </div>

          <div className="mb-5 flex rounded-lg border border-hairline bg-surface-2 p-0.5">
            {(['login', 'register'] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                aria-pressed={mode === value}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === value ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {value === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {mode === 'register' ? (
              <Field label="Full name" required error={fieldError('name')}>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Akarsh Shrivastava"
                  autoComplete="name"
                  required
                />
              </Field>
            ) : null}

            <Field label="Work email" required error={fieldError('email')}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field
              label="Password"
              required
              error={fieldError('password')}
              hint={mode === 'register' ? 'At least 8 characters' : undefined}
            >
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </Field>

            {mode === 'register' ? (
              <Field
                label="Organization name"
                hint="You become its OWNER. Leave blank for a default name."
                error={fieldError('organization_name')}
              >
                <Input
                  value={form.organization_name}
                  onChange={(event) => setForm({ ...form, organization_name: event.target.value })}
                  placeholder="Confluencr Media Pvt Ltd"
                />
              </Field>
            ) : null}

            <ErrorNotice error={error} className="pt-1" />

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              className="w-full"
              icon={mode === 'login' ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
            >
              {mode === 'login' ? 'Sign in' : 'Create account & organization'}
            </Button>
          </form>
        </Card>

        <Card className="animate-rise">
          <h2 className="text-sm font-semibold text-ink">Seeded demo logins</h2>
          <p className="mt-1 text-xs text-ink-3">
            Run <code className="rounded bg-surface-2 px-1 py-0.5 text-ink-2">npm run seed</code> in{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-ink-2">backend/</code>, then sign
            in as any role. Password for all five:{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-ink-2">Password123!</code>
          </p>

          <ul className="mt-4 space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  onClick={() => {
                    setMode('login');
                    setForm({ ...form, email: account.email, password: 'Password123!' });
                    setError(null);
                  }}
                  className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-series-1">
                      {account.role}
                    </span>
                    <span className="text-[11px] text-ink-3">use</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink">{account.email}</span>
                  <span className="block text-[11px] text-ink-3">{account.can}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
