import type { Role } from '../rbac/permissions.js';

export type UserRow = {
  id: string;
  email: string;
  email_lower: string;
  name: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountStatus = 'active' | 'frozen' | 'closed';

export type AccountRow = {
  id: string;
  org_id: string;
  code: string;
  name: string;
  holder_email: string | null;
  currency: string;
  status: AccountStatus;
  balance_minor: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TransactionType = 'credit' | 'debit';

export type TransactionRow = {
  id: string;
  org_id: string;
  account_id: string;
  type: TransactionType;
  amount_minor: number;
  balance_after_minor: number;
  description: string | null;
  reference_id: string;
  transfer_id: string | null;
  counterparty_account_id: string | null;
  created_by: string;
  created_at: string;
};

export type TransferRow = {
  id: string;
  org_id: string;
  from_account_id: string;
  to_account_id: string;
  amount_minor: number;
  currency: string;
  reference_id: string;
  description: string | null;
  status: 'completed';
  created_by: string;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  org_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  ip_address: string | null;
  created_at: string;
};
