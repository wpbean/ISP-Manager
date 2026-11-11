import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Moon, Palette, Sun, User } from 'lucide-react';
import { toast } from 'sonner';
import { changePasswordSchema, ROLE_LABELS } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, CardHeader, DataItem, Field, Input, PageHeader } from '@/components/ui';

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const { register, handleSubmit, reset, formState } = useForm({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', v);
      toast.success('Password changed');
      reset();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Your profile and preferences." />
      <Card>
        <CardHeader title="Profile" icon={<User className="size-[18px]" />} />
        <dl className="grid gap-5 px-6 pb-6 sm:grid-cols-3">
          <DataItem label="Name" value={user?.name} />
          <DataItem label="Email" value={user?.email} />
          <DataItem label="Role" value={user ? ROLE_LABELS[user.role] : ''} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Appearance" icon={<Palette className="size-[18px]" />} />
        <div className="flex items-center justify-between px-6 pb-6">
          <p className="text-sm text-muted-strong">Theme: <span className="font-medium text-strong capitalize">{theme}</span></p>
          <Button variant="secondary" onClick={toggle}>
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />} Switch to {theme === 'dark' ? 'light' : 'dark'}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" icon={<KeyRound className="size-[18px]" />} />
        <form onSubmit={onSubmit} className="grid gap-4 px-6 pb-6 sm:grid-cols-2" noValidate>
          <Field label="Current password" error={formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
          </Field>
          <Field label="New password" error={formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={formState.isSubmitting}>Update password</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
