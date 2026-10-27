import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import type {
  Account,
  AccountMatrixPoint,
  AuditLog,
  CashflowPoint,
  DistributionSlice,
  Envelope,
  HeatmapBucket,
  IntegrityReport,
  Member,
  Organization,
  Overview,
  Pagination,
  Role,
  RoleMatrixEntry,
  TopAccount,
  Transaction,
  TransactionTotals,
  Transfer,
  TypeSplit,
} from '../lib/types';

type QueryValue = string | number | boolean | undefined;
type ListMeta = { pagination: Pagination; totals?: TransactionTotals; sort?: unknown; filters?: unknown };

const orgBase = (orgId: string) => `/organizations/${orgId}`;

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function useOverview(orgId: string) {
  return useQuery({
    queryKey: ['overview', orgId],
    queryFn: () => apiRequest<Envelope<Overview>>(`${orgBase(orgId)}/analytics/overview`),
    select: (response) => response.data,
  });
}

export function useCashflow(orgId: string, days: number) {
  return useQuery({
    queryKey: ['cashflow', orgId, days],
    queryFn: () =>
      apiRequest<Envelope<CashflowPoint[]>>(`${orgBase(orgId)}/analytics/cashflow`, {
        query: { days },
      }),
    select: (response) => response.data,
  });
}

export function useBalanceDistribution(orgId: string, limit = 7) {
  return useQuery({
    queryKey: ['distribution', orgId, limit],
    queryFn: () =>
      apiRequest<Envelope<DistributionSlice[], { total_balance: number; account_count: number }>>(
        `${orgBase(orgId)}/analytics/balance-distribution`,
        { query: { limit } },
      ),
  });
}

export function useTypeSplit(orgId: string) {
  return useQuery({
    queryKey: ['type-split', orgId],
    queryFn: () =>
      apiRequest<Envelope<TypeSplit[], { total_count: number; total_amount: number }>>(
        `${orgBase(orgId)}/analytics/type-split`,
      ),
  });
}

export function useAccountMatrix(orgId: string) {
  return useQuery({
    queryKey: ['account-matrix', orgId],
    queryFn: () =>
      apiRequest<Envelope<AccountMatrixPoint[]>>(`${orgBase(orgId)}/analytics/account-matrix`),
    select: (response) => response.data,
  });
}

export function useActivityHeatmap(orgId: string, days: number) {
  return useQuery({
    queryKey: ['heatmap', orgId, days],
    queryFn: () =>
      apiRequest<Envelope<HeatmapBucket[]>>(`${orgBase(orgId)}/analytics/activity-heatmap`, {
        query: { days },
      }),
    select: (response) => response.data,
  });
}

export function useTopAccounts(orgId: string, limit = 6) {
  return useQuery({
    queryKey: ['top-accounts', orgId, limit],
    queryFn: () =>
      apiRequest<Envelope<TopAccount[]>>(`${orgBase(orgId)}/analytics/top-accounts`, {
        query: { limit },
      }),
    select: (response) => response.data,
  });
}

export function useLedgerIntegrity(orgId: string) {
  return useQuery({
    queryKey: ['integrity', orgId],
    queryFn: () => apiRequest<Envelope<IntegrityReport>>(`${orgBase(orgId)}/ledger/integrity`),
    select: (response) => response.data,
    retry: false,
  });
}

export function useAccounts(
  orgId: string,
  params: { page?: number; limit?: number; q?: string; status?: string; sort?: string; order?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['accounts', orgId, params],
    queryFn: () =>
      apiRequest<Envelope<Account[], ListMeta>>(`${orgBase(orgId)}/accounts`, {
        query: params as Record<string, QueryValue>,
      }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useAccount(orgId: string, accountId: string | undefined) {
  return useQuery({
    queryKey: ['account', orgId, accountId],
    queryFn: () => apiRequest<Envelope<Account>>(`${orgBase(orgId)}/accounts/${accountId}`),
    select: (response) => response.data,
    enabled: Boolean(accountId),
  });
}

export type TransactionFilters = {
  page?: number;
  limit?: number;
  account_id?: string;
  type?: string;
  reference_id?: string;
  q?: string;
  from?: string;
  to?: string;
  min_amount?: string;
  max_amount?: string;
  transfers_only?: boolean;
  sort?: string;
  order?: string;
};

export function useTransactions(orgId: string, filters: TransactionFilters, enabled = true) {
  return useQuery({
    queryKey: ['transactions', orgId, filters],
    queryFn: () =>
      apiRequest<Envelope<Transaction[], ListMeta>>(`${orgBase(orgId)}/transactions`, {
        query: filters as Record<string, QueryValue>,
      }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useAccountTransactions(
  orgId: string,
  accountId: string | undefined,
  params: { page?: number; limit?: number },
) {
  return useQuery({
    queryKey: ['account-transactions', orgId, accountId, params],
    queryFn: () =>
      apiRequest<Envelope<Transaction[], ListMeta>>(
        `${orgBase(orgId)}/accounts/${accountId}/transactions`,
        { query: params as Record<string, QueryValue> },
      ),
    enabled: Boolean(accountId),
    placeholderData: (previous) => previous,
  });
}

export function useTransfers(orgId: string, params: { page?: number; limit?: number; account_id?: string }) {
  return useQuery({
    queryKey: ['transfers', orgId, params],
    queryFn: () =>
      apiRequest<Envelope<Transfer[], ListMeta>>(`${orgBase(orgId)}/transfers`, {
        query: params as Record<string, QueryValue>,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useMembers(orgId: string, enabled = true) {
  return useQuery({
    queryKey: ['members', orgId],
    queryFn: () => apiRequest<Envelope<Member[]>>(`${orgBase(orgId)}/members`),
    select: (response) => response.data,
    enabled,
  });
}

export function useRoleMatrix() {
  return useQuery({
    queryKey: ['role-matrix'],
    queryFn: () => apiRequest<Envelope<RoleMatrixEntry[]>>('/auth/roles'),
    select: (response) => response.data,
    staleTime: Infinity,
  });
}

export function useAuditLogs(orgId: string, params: { page?: number; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: ['audit-logs', orgId, params],
    queryFn: () =>
      apiRequest<Envelope<AuditLog[], { pagination: Pagination }>>(`${orgBase(orgId)}/audit-logs`, {
        query: params as Record<string, QueryValue>,
      }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () =>
      apiRequest<Envelope<{ status: string; version: string; environment: string; uptime_seconds: number }>>(
        '/health',
      ),
    select: (response) => response.data,
    refetchInterval: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/** Anything that moves money invalidates balances, charts and the audit trail. */
function ledgerKeys(orgId: string) {
  return [
    ['overview', orgId],
    ['cashflow', orgId],
    ['distribution', orgId],
    ['type-split', orgId],
    ['account-matrix', orgId],
    ['heatmap', orgId],
    ['top-accounts', orgId],
    ['integrity', orgId],
    ['accounts', orgId],
    ['account', orgId],
    ['transactions', orgId],
    ['account-transactions', orgId],
    ['transfers', orgId],
    ['audit-logs', orgId],
  ];
}

function useLedgerInvalidation(orgId: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ledgerKeys(orgId)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCreateAccount(orgId: string) {
  const invalidate = useLedgerInvalidation(orgId);
  return useMutation({
    mutationFn: (body: {
      name: string;
      currency?: string;
      holder_email?: string;
      opening_balance?: string;
    }) =>
      apiRequest<Envelope<Account>>(`${orgBase(orgId)}/accounts`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount(orgId: string) {
  const invalidate = useLedgerInvalidation(orgId);
  return useMutation({
    mutationFn: ({ accountId, ...body }: { accountId: string; name?: string; status?: string }) =>
      apiRequest<Envelope<Account>>(`${orgBase(orgId)}/accounts/${accountId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function useCreateTransaction(orgId: string) {
  const invalidate = useLedgerInvalidation(orgId);
  return useMutation({
    mutationFn: (body: {
      account_id: string;
      type: string;
      amount: string;
      reference_id: string;
      description?: string;
    }) =>
      apiRequest<Envelope<Transaction & { account: Account }>>(`${orgBase(orgId)}/transactions`, {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function useCreateTransfer(orgId: string) {
  const invalidate = useLedgerInvalidation(orgId);
  return useMutation({
    mutationFn: (body: {
      from_account_id: string;
      to_account_id: string;
      amount: string;
      reference_id: string;
      description?: string;
    }) =>
      apiRequest<Envelope<Transfer & { from_account: Account; to_account: Account }>>(
        `${orgBase(orgId)}/transfers`,
        { method: 'POST', body },
      ),
    onSuccess: invalidate,
  });
}

export function useAddMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: Role; name?: string }) =>
      apiRequest<Envelope<Member>>(`${orgBase(orgId)}/members`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
    },
  });
}

export function useUpdateMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiRequest<Envelope<Member>>(`${orgBase(orgId)}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs', orgId] });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiRequest<void>(`${orgBase(orgId)}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
    },
  });
}

export function useCreateOrganization() {
  return useMutation({
    mutationFn: (body: { name: string; currency?: string }) =>
      apiRequest<Envelope<Organization>>('/organizations', { method: 'POST', body }),
  });
}

export function useRenameOrganization(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      apiRequest<Envelope<Organization>>(orgBase(orgId), { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs', orgId] });
    },
  });
}
