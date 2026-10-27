import { Check, KeyRound, Minus, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorNotice,
  Field,
  Input,
  Modal,
  RolePill,
  SectionHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAddMember, useMembers, useRemoveMember, useRoleMatrix, useUpdateMemberRole } from '../hooks/queries';
import { ApiError } from '../lib/api';
import { dateOnly, humanise, initials } from '../lib/format';
import type { Role } from '../lib/types';

const ROLE_SUMMARY: Record<Role, string> = {
  OWNER: 'Full control, including organization settings and deletion.',
  ADMIN: 'Manages accounts and members; cannot touch an OWNER or delete the organization.',
  EDITOR: 'Creates accounts, posts transactions and runs transfers.',
  AUDITOR: 'Read-only, plus access to the audit trail.',
  READER: 'Read-only access to accounts, transactions and analytics.',
};

const ASSIGNABLE: Role[] = ['ADMIN', 'EDITOR', 'AUDITOR', 'READER'];

export function AccessControlPage() {
  const { organization, user, can } = useAuth();
  const orgId = organization?.id ?? '';
  const toast = useToast();

  const members = useMembers(orgId, can('member:read'));
  const matrix = useRoleMatrix();
  const addMember = useAddMember(orgId);
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<{ email: string; name: string; role: Role }>({
    email: '',
    name: '',
    role: 'READER',
  });
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const canManage = can('member:manage');
  const permissions = matrix.data?.flatMap((entry) => entry.permissions) ?? [];
  const allPermissions = [...new Set(permissions)].sort();

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await addMember.mutateAsync({
        email: invite.email,
        role: invite.role,
        ...(invite.name ? { name: invite.name } : {}),
      });
      if (created.data.temporary_password) {
        setIssuedPassword({
          email: created.data.user.email,
          password: created.data.temporary_password,
        });
      }
      toast.push({
        tone: 'good',
        title: 'Member added',
        body: `${created.data.user.email} joined as ${created.data.role}`,
      });
      setInvite({ email: '', name: '', role: 'READER' });
      addMember.reset();
      setInviteOpen(false);
    } catch {
      /* rendered inline */
    }
  };

  const changeRole = async (userId: string, role: Role, label: string) => {
    try {
      await updateRole.mutateAsync({ userId, role });
      toast.push({ tone: 'good', title: `${label} is now ${role}` });
    } catch (error) {
      toast.push({
        tone: 'critical',
        title: error instanceof ApiError ? error.code : 'Role change rejected',
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const remove = async (userId: string, label: string) => {
    try {
      await removeMember.mutateAsync(userId);
      toast.push({ tone: 'good', title: `${label} removed from the organization` });
    } catch (error) {
      toast.push({
        tone: 'critical',
        title: error instanceof ApiError ? error.code : 'Removal rejected',
        body: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Access control</h1>
          <p className="mt-1 text-sm text-ink-2">
            Membership of <span className="text-ink">{organization?.name}</span> decides what every
            request is allowed to do. Your role is{' '}
            <span className="font-medium text-ink">{organization?.role}</span>.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="primary"
            onClick={() => setInviteOpen(true)}
            icon={<UserPlus className="size-4" />}
          >
            Add member
          </Button>
        ) : null}
      </div>

      {issuedPassword ? (
        <div className="mb-4">
          <Alert tone="warning" title="Temporary password — shown once">
            <p>
              <span className="font-medium">{issuedPassword.email}</span> can sign in with{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">
                {issuedPassword.password}
              </code>
            </p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setIssuedPassword(null)}>
              Dismiss
            </Button>
          </Alert>
        </div>
      ) : null}

      <Card className="mb-4">
        <SectionHeader
          title="Members"
          subtitle="One membership row per user, per organization"
          actions={<Badge>{members.data?.length ?? 0} members</Badge>}
        />
        <ErrorNotice error={members.error} className="mb-3" />

        {members.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Capabilities</Th>
                <Th align="right">Joined</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(members.data ?? []).map((member) => {
                const isSelf = member.user.id === user?.id;
                return (
                  <tr key={member.id} className="hover:bg-surface-2">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-ink-2">
                          {initials(member.user.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {member.user.name}
                            {isSelf ? <span className="ml-1.5 text-[11px] text-ink-3">(you)</span> : null}
                          </span>
                          <span className="block truncate text-[11px] text-ink-3">
                            {member.user.email}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <RolePill role={member.role} />
                    </Td>
                    <Td className="max-w-[320px] text-xs text-ink-3">
                      {ROLE_SUMMARY[member.role]}
                    </Td>
                    <Td align="right">{dateOnly(member.created_at)}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2">
                        {canManage && !isSelf ? (
                          <Select
                            value={member.role}
                            onChange={(event) =>
                              changeRole(member.user.id, event.target.value as Role, member.user.name)
                            }
                            className="h-8 w-auto min-w-[120px] text-xs"
                          >
                            {(['OWNER', ...ASSIGNABLE] as Role[]).map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </Select>
                        ) : null}
                        {canManage && !isSelf ? (
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<Trash2 className="size-3.5" />}
                            onClick={() => remove(member.user.id, member.user.name)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Permission matrix"
          subtitle="Served by GET /api/v1/auth/roles — the same table the API enforces"
          actions={<Badge icon={<KeyRound className="size-3" />}>{allPermissions.length} permissions</Badge>}
        />

        {matrix.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Permission</Th>
                {(matrix.data ?? []).map((entry) => (
                  <Th key={entry.role} align="center">
                    {entry.role}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPermissions.map((permission) => (
                <tr key={permission} className="hover:bg-surface-2">
                  <Td>
                    <span className="font-mono text-[12px] text-ink">{permission}</span>
                    <span className="block text-[11px] text-ink-3">{humanise(permission)}</span>
                  </Td>
                  {(matrix.data ?? []).map((entry) => (
                    <Td key={entry.role} align="center">
                      {entry.permissions.includes(permission) ? (
                        <span
                          className="inline-flex items-center gap-1 text-[#6ee06e]"
                          title={`${entry.role} has ${permission}`}
                        >
                          <Check className="size-4" />
                          <span className="sr-only">allowed</span>
                        </span>
                      ) : (
                        <span className="inline-flex text-ink-3" title={`${entry.role} cannot ${permission}`}>
                          <Minus className="size-4" />
                          <span className="sr-only">denied</span>
                        </span>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a member"
        description="If the email has no account yet, one is created and a temporary password is returned once."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              form="invite-form"
              type="submit"
              loading={addMember.isPending}
              icon={<UserPlus className="size-4" />}
            >
              Add member
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={submitInvite} className="space-y-3.5">
          <Field
            label="Email"
            required
            error={addMember.error instanceof ApiError ? addMember.error.fieldError('email') : undefined}
          >
            <Input
              type="email"
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
              placeholder="teammate@confluencr.com"
              required
              autoFocus
            />
          </Field>
          <Field label="Name" hint="Used when a new user account has to be created">
            <Input
              value={invite.name}
              onChange={(event) => setInvite({ ...invite, name: event.target.value })}
              placeholder="Riya Malhotra"
            />
          </Field>
          <Field label="Role" required hint={ROLE_SUMMARY[invite.role]}>
            <Select
              value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}
            >
              {(organization?.role === 'OWNER' ? (['OWNER', ...ASSIGNABLE] as Role[]) : ASSIGNABLE).map(
                (role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <ErrorNotice error={addMember.error} />
        </form>
      </Modal>
    </>
  );
}
