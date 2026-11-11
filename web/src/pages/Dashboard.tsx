import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { AlertTriangle, BarChart3, CalendarClock, ChevronRight, Table2, UserCheck, Users, UserX } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@isp/shared';
import { useDashboard } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { fmtCompactMoney, fmtDateTime, fmtMoney, monthLabel } from '@/lib/format';
import { BarTrend } from '@/components/BarTrend';
import { Card, CardHeader, EmptyState, ExpiryText, PageHeader, Skeleton } from '@/components/ui';

function StatTile({ label, value, icon, foot, to }: { label: string; value: ReactNode; icon: ReactNode; foot?: ReactNode; to?: string }) {
  const body = (
    <Card className={clsx('h-full p-5 transition-colors', to && 'hover:bg-surface-2/70')}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className="text-muted">{icon}</span>
      </div>
      <p className="num mt-3 text-[32px] leading-none font-bold tracking-tight text-strong">{value}</p>
      {foot && <div className="mt-3 text-xs text-muted">{foot}</div>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="text-muted">No data last month</span>;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={clsx('num font-medium', up ? 'text-up' : 'text-down')}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%<span className="ml-1 font-normal text-muted">vs last month</span>
    </span>
  );
}

const STATUS_SEGMENTS = [
  { key: 'active', label: 'Active', className: 'bg-up' },
  { key: 'pending', label: 'Pending', className: 'bg-info' },
  { key: 'suspended', label: 'Suspended', className: 'bg-warn' },
  { key: 'disconnected', label: 'Disconnected', className: 'bg-down' },
] as const;

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const { can, user } = useAuth();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const showMoney = can('payments:read');

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const { customers: c, revenue: r } = data;
  const collectionRate = r.expectedMonthly ? Math.min(100, (r.thisMonth / r.expectedMonthly) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome back, ${user?.name.split(' ')[0] ?? ''}`} subtitle="Here's what's happening across your network today." />

      {/* Revenue hero (stat-callout: yellow BinancePlex-style numbers) */}
      {showMoney && (
        <Card className="grid gap-8 p-6 md:grid-cols-[1.4fr_1fr_1fr] md:p-8">
          <div>
            <p className="text-[13px] font-medium text-muted">Collected this month</p>
            <p className="num mt-2 text-[40px] leading-[1.1] font-bold tracking-tight text-accent">{fmtMoney(r.thisMonth)}</p>
            <p className="mt-2 text-xs">
              <Delta now={r.thisMonth} prev={r.lastMonth} />
            </p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted">Collected today</p>
            <p className="num mt-2 text-2xl font-bold text-strong">{fmtMoney(r.today)}</p>
            <p className="mt-2 text-xs text-muted">
              Last month <span className="num text-muted-strong">{fmtMoney(r.lastMonth)}</span>
            </p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted">Expected monthly (active)</p>
            <p className="num mt-2 text-2xl font-bold text-strong">{fmtMoney(r.expectedMonthly)}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(collectionRate)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${collectionRate}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              <span className="num text-muted-strong">{collectionRate.toFixed(0)}%</span> collected
            </p>
          </div>
        </Card>
      )}

      {/* Customer stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total customers"
          value={c.total}
          icon={<Users className="size-5" />}
          to="/customers"
          foot={<span><span className="num text-up">+{c.newThisMonth}</span> new this month</span>}
        />
        <StatTile
          label="Active"
          value={c.active}
          icon={<UserCheck className="size-5" />}
          to="/customers?status=ACTIVE"
          foot={<span><span className="num text-muted-strong">{c.total ? ((c.active / c.total) * 100).toFixed(0) : 0}%</span> of all customers</span>}
        />
        <StatTile
          label="Expiring in 7 days"
          value={<span className={c.expiringSoon ? 'text-warn' : undefined}>{c.expiringSoon}</span>}
          icon={<CalendarClock className="size-5" />}
          to="/customers?expiry=expiring"
          foot="Remind before service lapses"
        />
        <StatTile
          label="Expired"
          value={<span className={c.expired ? 'text-down' : undefined}>{c.expired}</span>}
          icon={<UserX className="size-5" />}
          to="/customers?expiry=expired"
          foot="Excludes disconnected"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Collections trend */}
        {showMoney ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Monthly collections"
              subtitle="Payments received, last 12 months"
              action={
                <div className="flex rounded-md bg-surface-2 p-0.5" role="group" aria-label="View">
                  {(['chart', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      aria-pressed={view === v}
                      className={clsx('flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium', view === v ? 'bg-surface text-strong' : 'text-muted')}
                    >
                      {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
                      {v === 'chart' ? 'Chart' : 'Table'}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="px-4 pb-5 md:px-6">
              {view === 'chart' ? (
                <BarTrend data={data.monthly} valueKey="collected" format={fmtMoney} tickFormat={fmtCompactMoney} height={340} />
              ) : (
                <div className="scrollbar-thin max-h-[340px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-muted"><th className="py-2 text-left font-medium">Month</th><th className="py-2 text-right font-medium">Collected</th><th className="py-2 text-right font-medium">New customers</th></tr></thead>
                    <tbody>
                      {[...data.monthly].reverse().map((m) => (
                        <tr key={m.month} className="border-t border-hairline">
                          <td className="py-2 text-muted-strong">{monthLabel(m.month)} {m.month.slice(0, 4)}</td>
                          <td className="num py-2 text-right text-strong">{fmtMoney(m.collected)}</td>
                          <td className="num py-2 text-right text-strong">{m.newCustomers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card className="xl:col-span-2">
            <CardHeader title="New customers" subtitle="Connections added, last 12 months" />
            <div className="px-4 pb-5 md:px-6">
              <BarTrend data={data.monthly} valueKey="newCustomers" format={(n) => `${n} customers`} />
            </div>
          </Card>
        )}

        {/* Status breakdown — segmented bar with labelled legend (never color alone) */}
        <Card>
          <CardHeader title="Customer status" subtitle={<span><span className="num">{c.total}</span> total connections</span>} />
          <div className="px-6 pb-6">
            <div className="flex h-3 gap-[2px] overflow-hidden rounded-sm" aria-hidden>
              {STATUS_SEGMENTS.map((s) =>
                c[s.key] ? <div key={s.key} className={s.className} style={{ flexGrow: c[s.key] }} title={`${s.label}: ${c[s.key]}`} /> : null,
              )}
            </div>
            <ul className="mt-5 divide-y divide-hairline">
              {STATUS_SEGMENTS.map((s) => (
                <li key={s.key}>
                  <Link to={`/customers?status=${s.key.toUpperCase()}`} className="flex items-center justify-between py-3 text-sm hover:text-strong">
                    <span className="flex items-center gap-2.5 text-muted-strong">
                      <span className={clsx('size-2.5 rounded-sm', s.className)} />
                      {s.label}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="num font-medium text-strong">{c[s.key]}</span>
                      <span className="num w-10 text-right text-xs text-muted">{c.total ? ((c[s.key] / c.total) * 100).toFixed(0) : 0}%</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {showMoney && (
              <div className="mt-4 border-t border-hairline pt-4">
                <p className="text-xs font-medium text-muted">New customers / month</p>
                <BarTrend data={data.monthly.slice(-6)} valueKey="newCustomers" format={(n) => `${n} new`} height={110} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Expiring soon"
            subtitle="Service ends within 7 days"
            icon={<AlertTriangle className="size-[18px]" />}
            action={<Link to="/customers?expiry=expiring" className="text-[13px] font-medium text-accent">View all</Link>}
          />
          {data.expiringSoon.length === 0 ? (
            <EmptyState title="Nothing expiring" message="No customers expire in the next 7 days." />
          ) : (
            <ul className="pb-2">
              {data.expiringSoon.map((x) => (
                <li key={x.id} className="border-t border-hairline">
                  <Link to={`/customers/${x.id}`} className="flex items-center gap-4 px-6 py-3 hover:bg-surface-2/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-strong">{x.name}</p>
                      <p className="num text-xs text-muted">{x.customerCode} · {x.phone}</p>
                    </div>
                    <span className="num text-sm text-muted-strong">{fmtMoney(x.monthlyFee)}</span>
                    <div className="w-24 text-right"><ExpiryText date={x.expireDate} /></div>
                    <ChevronRight className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {showMoney && (
          <Card>
            <CardHeader title="Recent payments" subtitle="Latest collections" action={<Link to="/payments" className="text-[13px] font-medium text-accent">View all</Link>} />
            {data.recentPayments.length === 0 ? (
              <EmptyState title="No payments yet" />
            ) : (
              <ul className="pb-2">
                {data.recentPayments.map((p) => (
                  <li key={p.id} className="border-t border-hairline">
                    <Link to={`/customers/${p.customerId}`} className="flex items-center gap-4 px-6 py-3 hover:bg-surface-2/50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-strong">{p.customer?.name}</p>
                        <p className="text-xs text-muted">
                          <span className="num">{p.receiptNo}</span> · {PAYMENT_METHOD_LABELS[p.method]} · {fmtDateTime(p.paidAt)}
                        </p>
                      </div>
                      <span className="num text-sm font-semibold text-up">+{fmtMoney(p.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
