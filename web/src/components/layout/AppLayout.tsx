import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { ROLE_LABELS, type Permission } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Avatar, Button, IconButton } from '@/components/ui';
import { Logo } from './Logo';
import { HeaderSlotContext } from './HeaderActions';

const NAV: { to: string; label: string; icon: typeof Users; perm?: Permission; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard:read', end: true },
  { to: '/customers', label: 'Customers', icon: Users, perm: 'customers:read' },
  { to: '/payments', label: 'Payments', icon: CreditCard, perm: 'payments:read' },
  { to: '/network', label: 'Network Map', icon: Network, perm: 'network:read' },
  { to: '/users', label: 'Staff & Roles', icon: ShieldCheck, perm: 'users:manage' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Max content width per route — see AppLayout <main>. */
function pageWidth(path: string) {
  if (path.startsWith('/network')) return 'max-w-none';
  if (path === '/customers' || path === '/payments' || path === '/users') return 'max-w-[1440px] min-[1920px]:max-w-[1920px]';
  return 'max-w-[1440px]';
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.filter((n) => !n.perm || can(n.perm)).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
              isActive ? 'bg-surface-2 text-strong' : 'text-muted-strong hover:bg-surface-2/60 hover:text-strong',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-primary" />}
              <Icon className={clsx('size-[18px]', isActive ? 'text-accent' : 'text-muted group-hover:text-muted-strong')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBlock() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-2/60 p-3">
      <Avatar name={user.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-strong">{user.name}</p>
        <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
      </div>
      <IconButton label="Log out" onClick={logout}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}

export function AppLayout() {
  const { theme, toggle } = useTheme();
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const [slotClaims, setSlotClaims] = useState(0);
  const claim = useCallback((delta: 1 | -1) => setSlotClaims((n) => n + delta), []);
  const headerSlot = useMemo(() => ({ el: slotEl, claim }), [slotEl, claim]);

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-hairline bg-canvas px-4 py-5 lg:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <NavItems />
        <div className="mt-auto">
          <UserBlock />
        </div>
      </aside>

      {/* Mobile drawer (full-screen sheet) */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-canvas px-5 py-4 lg:hidden">
          <div className="mb-6 flex items-center justify-between">
            <Logo />
            <IconButton label="Close menu" onClick={() => setDrawer(false)}>
              <X className="size-5" />
            </IconButton>
          </div>
          <NavItems onNavigate={() => setDrawer(false)} />
          <div className="mt-auto space-y-3">
            {can('customers:create') && (
              <Button className="w-full" size="lg" pill onClick={() => navigate('/customers/new')}>
                <Plus className="size-4" /> New Customer
              </Button>
            )}
            <UserBlock />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-hairline bg-canvas/95 px-4 backdrop-blur md:px-8">
          <IconButton label="Open menu" className="lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
          </IconButton>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
              {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </IconButton>
            <div ref={setSlotEl} className="flex items-center gap-2 empty:hidden" />
            {slotClaims === 0 && can('customers:create') && (
              <Button size="sm" className="hidden sm:inline-flex" onClick={() => navigate('/customers/new')}>
                <Plus className="size-4" /> New Customer
              </Button>
            )}
          </div>
        </header>

        <main
          className={clsx(
            'mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8',
            // Canvas pages (network map) use every pixel on wide/ultra-wide screens; data tables
            // get a wider cap; reading pages (dashboard, forms, detail) keep a comfortable width.
            pageWidth(location.pathname),
          )}
        >
          <HeaderSlotContext.Provider value={headerSlot}>
            <Outlet />
          </HeaderSlotContext.Provider>
        </main>
      </div>
    </div>
  );
}
