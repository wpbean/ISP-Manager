import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS, type Role, type User } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { useDeleteUser, useSaveUser, useUsers } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, Field, IconButton, Input, Modal, PageHeader, PageLoader, Select, Td, Th } from '@/components/ui';

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full access including staff management.',
  MANAGER: 'Everything except managing staff accounts.',
  TECHNICIAN: 'View customers; edit ONU, fiber, RADIUS and GPS fields.',
  BILLING: 'View customers, record payments, export lists.',
};

interface Values { name: string; email: string; phone: string; role: Role; password: string; isActive: boolean }

function UserModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  const save = useSaveUser(user?.id);
  const { register, handleSubmit, reset, formState } = useForm<Values>();
  useEffect(() => {
    if (open) reset({ name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', role: user?.role ?? 'BILLING', password: '', isActive: user?.isActive ?? true });
  }, [open, user, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync(user ? { ...v, password: v.password || undefined } : v);
      toast.success(user ? 'Staff updated' : 'Staff account created');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title={user ? 'Edit staff' : 'Add staff'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required className="sm:col-span-2"><Input {...register('name', { required: true })} /></Field>
        <Field label="Email" required><Input type="email" {...register('email', { required: true })} /></Field>
        <Field label="Phone"><Input numeric {...register('phone')} /></Field>
        <Field label="Role" required>
          <Select {...register('role')}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
        </Field>
        <Field label={user ? 'New password' : 'Password'} required={!user} hint={user ? 'Leave blank to keep current' : 'At least 8 characters'}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted-strong sm:col-span-2">
          <input type="checkbox" className="size-4 accent-[#FCD535]" {...register('isActive')} /> Account active
        </label>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const { data: users, isLoading } = useUsers();
  const del = useDeleteUser();
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<User | null>(null);

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Staff & roles" subtitle="Who can access the system and what they can do." actions={<Button onClick={() => setEditing(null)}><Plus className="size-4" /> Add Staff</Button>} />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline"><tr><Th>Name</Th><Th>Role</Th><Th>Phone</Th><Th>Last login</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="border-b border-hairline last:border-0">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} />
                      <div><p className="font-medium text-strong">{u.name}{u.id === me?.id && <span className="ml-2 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></div>
                    </div>
                  </Td>
                  <Td><Badge tone={u.role === 'ADMIN' ? 'primary' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge></Td>
                  <Td className="num text-muted-strong">{u.phone ?? '—'}</Td>
                  <Td className="num text-muted-strong">{fmtDateTime(u.lastLoginAt)}</Td>
                  <Td>{u.isActive ? <Badge tone="up" dot>Active</Badge> : <Badge tone="down" dot>Disabled</Badge>}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <IconButton label="Edit" onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton>
                      {u.id !== me?.id && <IconButton label="Delete" className="hover:text-down" onClick={() => setToDelete(u)}><Trash2 className="size-4" /></IconButton>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Role permissions" icon={<ShieldCheck className="size-[18px]" />} />
        <div className="grid gap-4 px-6 pb-6 md:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg bg-surface-2 p-4">
              <p className="font-semibold text-strong">{ROLE_LABELS[r]}</p>
              <p className="mt-1 text-[13px] text-muted">{ROLE_DESCRIPTIONS[r]}</p>
              <p className="num mt-3 text-xs text-muted-strong">{ROLE_PERMISSIONS[r].length} permissions</p>
            </div>
          ))}
        </div>
      </Card>

      <UserModal user={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        danger
        title="Delete staff account?"
        confirmLabel="Delete"
        loading={del.isPending}
        message={`${toDelete?.name} will lose access immediately. Their past payments stay on record.`}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Staff deleted');
            setToDelete(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
