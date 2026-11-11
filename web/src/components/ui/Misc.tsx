import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-accent', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-surface-2 text-muted-strong">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <p className="text-base font-semibold text-strong">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight text-strong md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Underlined tab row, yellow active indicator (markets-table tab row). */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="scrollbar-thin flex gap-6 overflow-x-auto border-b border-hairline">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={clsx(
              'relative -mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
              active ? 'border-primary text-strong' : 'border-transparent text-muted hover:text-muted-strong',
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={clsx('num rounded-sm px-1.5 text-xs', active ? 'bg-primary/15 text-accent' : 'bg-surface-2 text-muted')}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline px-6 py-3 text-[13px] text-muted">
      <span>
        Showing <span className="num text-muted-strong">{from}–{to}</span> of <span className="num text-muted-strong">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          className="flex size-8 items-center justify-center rounded-md hover:bg-surface-2 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="num px-2 text-muted-strong">
          {page} / {totalPages}
        </span>
        <button
          className="flex size-8 items-center justify-center rounded-md hover:bg-surface-2 disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted-strong', className)}>
      {initials}
    </span>
  );
}

/** Table primitives — rows separated by hairlines, muted headers (markets-row). */
export const Th = ({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' }) => (
  <th className={clsx('px-4 py-3 text-xs font-medium whitespace-nowrap text-muted first:pl-6 last:pr-6', align === 'right' ? 'text-right' : 'text-left', className)}>
    {children}
  </th>
);
export const Td = ({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' }) => (
  <td className={clsx('px-4 py-3 align-middle first:pl-6 last:pr-6', align === 'right' && 'text-right', className)}>{children}</td>
);
