import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Mail, Wifi, Activity, MapPin } from 'lucide-react';
import { loginSchema } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Logo';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await login(email, password);
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true });
    } catch (e) {
      setError(errorMessage(e, 'Login failed'));
    }
  });

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand panel (dark) */}
      <div className="hidden flex-col justify-between bg-canvas p-12 lg:flex" data-theme="dark">
        <Logo />
        <div>
          <h1 className="text-5xl leading-[1.1] font-bold tracking-tight text-white">
            Every connection.
            <br />
            <span className="text-accent">One control room.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] text-[#929aa5]">
            Manage customers, fiber cores, ONUs, RADIUS accounts and billing for your network from a single dashboard.
          </p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-3">
            {[
              { icon: Wifi, label: 'ONU & fiber' },
              { icon: Activity, label: 'Live billing' },
              { icon: MapPin, label: 'GPS mapping' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-lg bg-[#1e2329] px-4 py-4">
                <Icon className="mb-2 size-5 text-accent" />
                <p className="text-[13px] font-semibold text-[#eaecef]">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-[#707a8a]">© {new Date().getFullYear()} ISP Manager</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-surface px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-[28px] font-bold tracking-tight text-strong">Log in</h2>
          <p className="mt-1 mb-8 text-sm text-muted">Sign in with your staff account.</p>

          {error && <div className="mb-5 rounded-lg bg-down/10 px-4 py-3 text-sm text-down">{error}</div>}

          <div className="space-y-4">
            <Field label="Email" error={formState.errors.email?.message} htmlFor="email">
              <Input id="email" type="email" autoComplete="email" leading={<Mail className="size-4" />} placeholder="you@company.com" {...register('email')} />
            </Field>
            <Field label="Password" error={formState.errors.password?.message} htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" leading={<Lock className="size-4" />} placeholder="••••••••" {...register('password')} />
            </Field>
          </div>
          <Button type="submit" size="lg" className="mt-7 w-full" loading={formState.isSubmitting}>
            Log In
          </Button>
          {import.meta.env.DEV && (
            <p className="mt-6 rounded-lg bg-surface-2 px-4 py-3 text-xs text-muted">
              Demo: <span className="num text-muted-strong">admin@isp.local</span> / <span className="num text-muted-strong">admin12345</span>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
