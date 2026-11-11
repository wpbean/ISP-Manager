import { env } from './env';

/**
 * Date-only columns (@db.Date) are stored as UTC midnight and exchanged with
 * clients as "YYYY-MM-DD" strings. Business "today" uses env.timezone.
 */

export function toDateOnly(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

export function fromDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" for the current day in the business timezone. */
export function todayStr(tz = env.timezone): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function todayDate(): Date {
  return toDateOnly(todayStr());
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Add months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which the given calendar day starts in the business timezone. */
export function zonedDayStart(s: string, tz = env.timezone): Date {
  const guess = toDateOnly(s);
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}
