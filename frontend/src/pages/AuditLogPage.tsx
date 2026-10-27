import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Pagination,
  PageHeader,
  RolePill,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAuditLogs } from '../hooks/queries';
import { dateTime, humanise } from '../lib/format';

const TONE_FOR_ACTION = (action: string) => {
  if (action.startsWith('transfer')) return 'info' as const;
  if (action.startsWith('transaction')) return 'info' as const;
  if (action.includes('removed') || action.includes('left')) return 'critical' as const;
  if (action.startsWith('member')) return 'warning' as const;
  return 'neutral' as const;
};

export function AuditLogPage() {
  const { organization, can } = useAuth();
  const orgId = organization?.id ?? '';
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const logs = useAuditLogs(orgId, { page, limit }, can('audit:read'));
  const rows = logs.data?.data ?? [];
  const meta = logs.data?.meta?.pagination;

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Append-only record of who did what, written in the same transaction as the change."
      />

      <Card>
        <ErrorNotice error={logs.error} className="mb-3" />

        {logs.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="size-6" />}
            title="Nothing recorded yet"
            description="Create an account or post a transaction and it will show up here."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Actor</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-2">
                    <Td className="whitespace-nowrap">{dateTime(log.created_at)}</Td>
                    <Td>
                      <Badge tone={TONE_FOR_ACTION(log.action)}>{humanise(log.action)}</Badge>
                    </Td>
                    <Td>
                      <span className="block text-ink">{log.actor.email ?? 'system'}</span>
                      {log.actor.role ? (
                        <span className="mt-0.5 inline-block">
                          <RolePill role={log.actor.role} />
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="block capitalize">{log.entity_type}</span>
                      {log.entity_id ? (
                        <span className="block font-mono text-[11px] text-ink-3">{log.entity_id}</span>
                      ) : null}
                    </Td>
                    <Td className="max-w-[320px]">
                      {log.metadata ? (
                        <code className="block truncate font-mono text-[11px] text-ink-3" title={JSON.stringify(log.metadata)}>
                          {JSON.stringify(log.metadata)}
                        </code>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="font-mono text-[11px]">{log.ip_address ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              meta={meta}
              onPageChange={setPage}
              onLimitChange={(value) => {
                setLimit(value);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>
    </>
  );
}
