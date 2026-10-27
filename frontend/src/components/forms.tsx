import { ArrowLeftRight, Plus, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  useAccounts,
  useCreateAccount,
  useCreateTransaction,
  useCreateTransfer,
} from '../hooks/queries';
import { ApiError } from '../lib/api';
import { money } from '../lib/format';
import type { Account } from '../lib/types';
import { CREDIT_COLOR, DEBIT_COLOR } from '../lib/viz';
import { Button, ErrorNotice, Field, Input, Modal, Select, Textarea, useToast } from './ui';

/** Reference ids must be unique per account, so new forms start from a fresh suggestion. */
function suggestReference(prefix: string): string {
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${prefix}-${stamp}`;
}

function useSelectableAccounts(orgId: string, enabled: boolean) {
  const query = useAccounts(orgId, { limit: 100, sort: 'name', order: 'asc' }, enabled);
  return useMemo(
    () => (query.data?.data ?? []).filter((account) => account.status === 'active'),
    [query.data],
  );
}

/* -------------------------------------------------------------------------- */

export function NewAccountModal({
  open,
  onClose,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
}) {
  const { organization } = useAuth();
  const toast = useToast();
  const mutation = useCreateAccount(orgId);
  const [form, setForm] = useState({ name: '', holder_email: '', opening_balance: '' });

  const fieldError = (field: string) =>
    mutation.error instanceof ApiError ? mutation.error.fieldError(field) : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await mutation.mutateAsync({
        name: form.name,
        ...(form.holder_email ? { holder_email: form.holder_email } : {}),
        ...(form.opening_balance ? { opening_balance: form.opening_balance } : {}),
      });
      toast.push({
        tone: 'good',
        title: 'Account created',
        body: `${created.data.name} · ${created.data.code}`,
      });
      setForm({ name: '', holder_email: '', opening_balance: '' });
      mutation.reset();
      onClose();
    } catch {
      /* the error is rendered inline */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New account"
      description="Balances start at zero. An opening balance is recorded as a credit entry."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            form="new-account-form"
            type="submit"
            loading={mutation.isPending}
            icon={<Wallet className="size-4" />}
          >
            Create account
          </Button>
        </>
      }
    >
      <form id="new-account-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Account name" required error={fieldError('name')}>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Creator Payouts"
            required
            autoFocus
          />
        </Field>
        <Field
          label="Holder email"
          hint="Optional reference for whoever owns this account"
          error={fieldError('holder_email')}
        >
          <Input
            type="email"
            value={form.holder_email}
            onChange={(event) => setForm({ ...form, holder_email: event.target.value })}
            placeholder="finance@brand.com"
          />
        </Field>
        <Field
          label={`Opening balance (${organization?.currency ?? 'INR'})`}
          hint="Optional. Posted as a credit so the balance always equals its transactions."
          error={fieldError('opening_balance')}
        >
          <Input
            inputMode="decimal"
            value={form.opening_balance}
            onChange={(event) => setForm({ ...form, opening_balance: event.target.value })}
            placeholder="0.00"
          />
        </Field>
        <ErrorNotice error={mutation.error} />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

export function NewTransactionModal({
  open,
  onClose,
  orgId,
  defaultAccountId,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  defaultAccountId?: string;
}) {
  const { organization } = useAuth();
  const toast = useToast();
  const accounts = useSelectableAccounts(orgId, open);
  const mutation = useCreateTransaction(orgId);
  const [form, setForm] = useState({
    account_id: defaultAccountId ?? '',
    type: 'credit',
    amount: '',
    reference_id: suggestReference('TXN'),
    description: '',
  });

  const selected: Account | undefined = accounts.find(
    (account) => account.id === (form.account_id || defaultAccountId),
  );

  const fieldError = (field: string) =>
    mutation.error instanceof ApiError ? mutation.error.fieldError(field) : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const accountId = form.account_id || defaultAccountId || '';
    try {
      const created = await mutation.mutateAsync({
        account_id: accountId,
        type: form.type,
        amount: form.amount,
        reference_id: form.reference_id,
        ...(form.description ? { description: form.description } : {}),
      });
      toast.push({
        tone: 'good',
        title: `${form.type === 'credit' ? 'Credit' : 'Debit'} posted`,
        body: `New balance ${money(created.data.account.balance, created.data.account.currency)}`,
      });
      setForm({
        account_id: accountId,
        type: form.type,
        amount: '',
        reference_id: suggestReference('TXN'),
        description: '',
      });
      mutation.reset();
      onClose();
    } catch {
      /* rendered inline */
    }
  };

  const insufficient =
    mutation.error instanceof ApiError && mutation.error.code === 'INSUFFICIENT_BALANCE';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post a transaction"
      description="Entries are immutable once written. Correct a mistake with a compensating entry."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            form="new-transaction-form"
            type="submit"
            loading={mutation.isPending}
            icon={<Plus className="size-4" />}
          >
            Post entry
          </Button>
        </>
      }
    >
      <form id="new-transaction-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Account" required error={fieldError('account_id')}>
          <Select
            value={form.account_id || defaultAccountId || ''}
            onChange={(event) => setForm({ ...form, account_id: event.target.value })}
            required
          >
            <option value="">Select an account…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} — {money(account.balance, account.currency)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Type" required error={fieldError('type')}>
          <div className="grid grid-cols-2 gap-2">
            {(['credit', 'debit'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm({ ...form, type })}
                aria-pressed={form.type === type}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
                  form.type === type
                    ? 'border-transparent text-white'
                    : 'border-hairline bg-surface-2 text-ink-2 hover:text-ink'
                }`}
                style={
                  form.type === type
                    ? { background: type === 'credit' ? CREDIT_COLOR : DEBIT_COLOR }
                    : undefined
                }
              >
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{
                    background:
                      form.type === type ? '#fff' : type === 'credit' ? CREDIT_COLOR : DEBIT_COLOR,
                  }}
                />
                {type === 'credit' ? 'Credit (in)' : 'Debit (out)'}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label={`Amount (${organization?.currency ?? 'INR'})`}
          required
          error={fieldError('amount')}
          hint={
            selected && form.type === 'debit'
              ? `Available: ${money(selected.balance, selected.currency)}`
              : 'Must be greater than 0, up to 2 decimal places'
          }
        >
          <Input
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            placeholder="1000.00"
            required
          />
        </Field>

        <Field
          label="Reference ID"
          required
          error={fieldError('reference_id')}
          hint="Unique per account — doubles as the idempotency key"
        >
          <Input
            value={form.reference_id}
            onChange={(event) => setForm({ ...form, reference_id: event.target.value })}
            required
          />
        </Field>

        <Field label="Description" error={fieldError('description')}>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Brand campaign invoice settled"
          />
        </Field>

        {insufficient && selected ? (
          <p className="text-xs text-[#ffcf6b]">
            This debit is larger than the balance of {selected.name}. Credit the account first or
            lower the amount.
          </p>
        ) : null}
        <ErrorNotice error={mutation.error} />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

export function NewTransferModal({
  open,
  onClose,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
}) {
  const { organization } = useAuth();
  const toast = useToast();
  const accounts = useSelectableAccounts(orgId, open);
  const mutation = useCreateTransfer(orgId);
  const [form, setForm] = useState({
    from_account_id: '',
    to_account_id: '',
    amount: '',
    reference_id: suggestReference('TRF'),
    description: '',
  });

  const source = accounts.find((account) => account.id === form.from_account_id);
  const destination = accounts.find((account) => account.id === form.to_account_id);
  const amountValue = Number(form.amount);
  const preview =
    source && destination && Number.isFinite(amountValue) && amountValue > 0
      ? {
          from: source.balance - amountValue,
          to: destination.balance + amountValue,
        }
      : null;

  const fieldError = (field: string) =>
    mutation.error instanceof ApiError ? mutation.error.fieldError(field) : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await mutation.mutateAsync({
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount: form.amount,
        reference_id: form.reference_id,
        ...(form.description ? { description: form.description } : {}),
      });
      toast.push({
        tone: 'good',
        title: 'Transfer completed',
        body: `${money(created.data.amount, created.data.currency)} · ${created.data.from_account.name} → ${created.data.to_account.name}`,
      });
      setForm({
        from_account_id: '',
        to_account_id: '',
        amount: '',
        reference_id: suggestReference('TRF'),
        description: '',
      });
      mutation.reset();
      onClose();
    } catch {
      /* rendered inline */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transfer money"
      description="The debit, the credit and both balance updates commit as one transaction."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            form="new-transfer-form"
            type="submit"
            loading={mutation.isPending}
            icon={<ArrowLeftRight className="size-4" />}
          >
            Transfer
          </Button>
        </>
      }
    >
      <form id="new-transfer-form" onSubmit={submit} className="space-y-3.5">
        <Field label="From account" required error={fieldError('from_account_id')}>
          <Select
            value={form.from_account_id}
            onChange={(event) => setForm({ ...form, from_account_id: event.target.value })}
            required
          >
            <option value="">Select the source…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} — {money(account.balance, account.currency)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="To account" required error={fieldError('to_account_id')}>
          <Select
            value={form.to_account_id}
            onChange={(event) => setForm({ ...form, to_account_id: event.target.value })}
            required
          >
            <option value="">Select the destination…</option>
            {accounts
              .filter((account) => account.id !== form.from_account_id)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} — {money(account.balance, account.currency)}
                </option>
              ))}
          </Select>
        </Field>

        <Field
          label={`Amount (${organization?.currency ?? 'INR'})`}
          required
          error={fieldError('amount')}
          hint={source ? `Available: ${money(source.balance, source.currency)}` : undefined}
        >
          <Input
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            placeholder="5000.00"
            required
          />
        </Field>

        <Field label="Reference ID" required error={fieldError('reference_id')}>
          <Input
            value={form.reference_id}
            onChange={(event) => setForm({ ...form, reference_id: event.target.value })}
            required
          />
        </Field>

        <Field label="Description" error={fieldError('description')}>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Monthly rebalance"
          />
        </Field>

        {preview ? (
          <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-xs">
            <p className="mb-1.5 font-medium text-ink-2">After this transfer</p>
            <p className="flex items-center justify-between text-ink-3">
              <span className="truncate">{source?.name}</span>
              <span className={`tabular ${preview.from < 0 ? 'text-[#ff8f8f]' : 'text-ink'}`}>
                {money(preview.from, source?.currency)}
              </span>
            </p>
            <p className="flex items-center justify-between text-ink-3">
              <span className="truncate">{destination?.name}</span>
              <span className="tabular text-ink">{money(preview.to, destination?.currency)}</span>
            </p>
            {preview.from < 0 ? (
              <p className="mt-1.5 text-[#ffcf6b]">
                The source does not hold enough balance — the API will reject this transfer.
              </p>
            ) : null}
          </div>
        ) : null}

        <ErrorNotice error={mutation.error} />
      </form>
    </Modal>
  );
}
