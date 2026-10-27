export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'AUDITOR' | 'READER';

export type Permission =
  | 'org:read'
  | 'org:update'
  | 'org:delete'
  | 'member:read'
  | 'member:manage'
  | 'account:read'
  | 'account:create'
  | 'account:update'
  | 'transaction:read'
  | 'transaction:create'
  | 'transfer:read'
  | 'transfer:create'
  | 'analytics:read'
  | 'audit:read';

export type Pagination = {
  page: number;
  limit: number;
  total_records: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
};

export type Envelope<T, M = unknown> = { data: T; meta?: M };

export type User = { id: string; name: string; email: string; created_at?: string };

export type Organization = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  role: Role;
  permissions?: Permission[];
  account_count?: number;
  member_count?: number;
  transaction_count?: number;
  total_balance?: number;
};

export type AccountStatus = 'active' | 'frozen' | 'closed';

export type Account = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  holder_email: string | null;
  currency: string;
  status: AccountStatus;
  balance: number;
  balance_minor: number;
  transaction_count?: number;
  created_at: string;
  updated_at: string;
};

export type TransactionType = 'credit' | 'debit';

export type Transaction = {
  id: string;
  organization_id: string;
  account_id: string;
  account_name?: string;
  account_code?: string;
  type: TransactionType;
  amount: number;
  amount_minor: number;
  balance_after: number;
  description: string | null;
  reference_id: string;
  transfer_id: string | null;
  counterparty_account_id: string | null;
  counterparty_account_name?: string | null;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
};

export type TransactionTotals = {
  credit_count: number;
  debit_count: number;
  total_credit: number;
  total_debit: number;
  net_amount: number;
};

export type Transfer = {
  id: string;
  organization_id: string;
  from_account_id: string;
  to_account_id: string;
  from_account_name?: string;
  to_account_name?: string;
  from_account_code?: string;
  to_account_code?: string;
  amount: number;
  currency: string;
  reference_id: string;
  description: string | null;
  status: 'completed';
  created_by_name?: string | null;
  created_at: string;
  legs?: Transaction[];
};

export type Member = {
  id: string;
  organization_id: string;
  role: Role;
  permissions: Permission[];
  created_at: string;
  user: User;
  temporary_password?: string;
};

export type AuditLog = {
  id: string;
  organization_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: { user_id: string | null; email: string | null; role: string | null };
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

export type Overview = {
  currency: string;
  accounts: { total: number; active: number; frozen: number; closed: number };
  balances: { total: number; largest_account_balance: number; average_per_account: number };
  transactions: {
    total: number;
    credits: number;
    debits: number;
    total_credit: number;
    total_debit: number;
    net_flow: number;
    average_amount: number;
    largest_amount: number;
    credit_share: number;
  };
  last_7_days: { transactions: number; total_credit: number; total_debit: number; net_flow: number };
  transfers: { total: number };
  members: { total: number };
};

export type CashflowPoint = {
  date: string;
  credit: number;
  debit: number;
  net: number;
  cumulative_balance: number;
  transaction_count: number;
};

export type DistributionSlice = {
  account_id: string;
  name: string;
  code: string;
  status: string;
  balance: number;
  share: number;
};

export type TypeSplit = {
  type: TransactionType;
  count: number;
  amount: number;
  count_share: number;
  amount_share: number;
};

export type AccountMatrixPoint = {
  account_id: string;
  name: string;
  code: string;
  status: AccountStatus;
  balance: number;
  transaction_count: number;
  total_credit: number;
  total_debit: number;
  throughput: number;
  last_activity_at: string | null;
};

export type HeatmapBucket = { weekday: number; hour: number; count: number; amount: number };

export type TopAccount = {
  account_id: string;
  name: string;
  code: string;
  transaction_count: number;
  total_credit: number;
  total_debit: number;
  balance: number;
};

export type IntegrityReport = {
  checked_accounts: number;
  consistent: boolean;
  total_stored_balance: number;
  total_derived_balance: number;
  mismatches: Array<{
    account_id: string;
    stored_balance: number;
    derived_balance: number;
    difference: number;
    transaction_count: number;
  }>;
};

export type RoleMatrixEntry = { role: Role; rank: number; permissions: Permission[] };
