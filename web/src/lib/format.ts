import { CURRENCY, EXPIRING_SOON_DAYS } from '@isp/shared';

const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtMoney = (n: number | null | undefined) => `${CURRENCY.symbol}${money.format(n ?? 0)}`;
export const fmtCompactMoney = (n: number) => `${CURRENCY.symbol}${compact.format(n)}`;
export const fmtNumber = (n: number | null | undefined) => (n == null ? '—' : money.format(n));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-03" → "03 Nov 2026" (no timezone shifting for date-only values). */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${pad(day!)} ${MONTHS[m! - 1]} ${y}`;
}

/** ISO timestamp → "03 Nov 2026, 14:05" in the browser's local time. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Whole days from today until the date (negative = past). */
export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = Date.parse(`${todayISO()}T00:00:00Z`);
  const x = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  return Math.round((x - t) / 86400000);
}

export type ExpiryState = 'none' | 'expired' | 'soon' | 'valid';
export function expiryState(d: string | null | undefined): ExpiryState {
  const n = daysUntil(d);
  if (n == null) return 'none';
  if (n < 0) return 'expired';
  if (n <= EXPIRING_SOON_DAYS) return 'soon';
  return 'valid';
}

export function monthLabel(ym: string) {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
