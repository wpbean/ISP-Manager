import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { CUSTOMER_STATUS_LABELS, type CustomerStatus } from '@isp/shared';
import { daysUntil, expiryState } from '@/lib/format';

type Tone = 'up' | 'down' | 'warn' | 'neutral' | 'info' | 'primary';

const tones: Record<Tone, string> = {
  up: 'text-up bg-up/12',
  down: 'text-down bg-down/12',
  warn: 'text-warn bg-warn/12',
  neutral: 'text-muted-strong bg-surface-2',
  info: 'text-info bg-info/12',
  primary: 'text-on-primary bg-primary',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const statusTone: Record<CustomerStatus, Tone> = {
  ACTIVE: 'up',
  PENDING: 'info',
  SUSPENDED: 'warn',
  DISCONNECTED: 'down',
};

export function StatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <Badge tone={statusTone[status]} dot>
      {CUSTOMER_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Expiry date with direction semantics: green valid, yellow soon, red expired. */
export function ExpiryText({ date, showDays = true }: { date: string | null; showDays?: boolean }) {
  const state = expiryState(date);
  const days = daysUntil(date);
  if (state === 'none') return <span className="text-muted">—</span>;
  const color = state === 'expired' ? 'text-down' : state === 'soon' ? 'text-warn' : 'text-up';
  const label =
    days === 0 ? 'today' : days! < 0 ? `${Math.abs(days!)}d ago` : `in ${days}d`;
  const [y, m, d] = date!.split('-');
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="num text-strong">{`${d}/${m}/${y}`}</span>
      {showDays && <span className={clsx('num text-xs', color)}>{state === 'expired' ? `▼ expired ${label}` : `▲ ${label}`}</span>}
    </span>
  );
}
