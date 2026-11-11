import type { Prisma } from '@prisma/client';
import { EXPIRING_SOON_DAYS, type CustomerData, type CustomerListQuery } from '@isp/shared';
import { addDays, todayDate, toDateOnly } from '../lib/dates';

const DATE_FIELDS = ['connectionDate', 'billingDate', 'expireDate'] as const;

/** Map validated input (possibly partial) to Prisma data. */
export function toCustomerData(input: Partial<CustomerData>): Prisma.CustomerUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if ((DATE_FIELDS as readonly string[]).includes(key)) {
      data[key] = value ? toDateOnly(value as string) : null;
    } else {
      data[key] = value;
    }
  }
  return data as Prisma.CustomerUncheckedUpdateInput;
}

export function formatCustomerCode(seq: number) {
  return `C-${String(seq).padStart(6, '0')}`;
}

export function buildCustomerWhere(q: Partial<CustomerListQuery>): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};
  const and: Prisma.CustomerWhereInput[] = [];

  if (q.q) {
    const term = q.q;
    and.push({
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { altPhone: { contains: term } },
        { customerCode: { contains: term, mode: 'insensitive' } },
        ...(/^\d{1,9}$/.test(term) ? [{ radiusId: Number(term) }] : []),
        { pppoeUsername: { contains: term, mode: 'insensitive' } },
        { onuSerial: { contains: term, mode: 'insensitive' } },
        { address: { contains: term, mode: 'insensitive' } },
      ],
    });
  }
  if (q.status) and.push({ status: q.status });
  if (q.area) and.push({ area: { equals: q.area, mode: 'insensitive' } });

  const today = todayDate();
  if (q.expiry === 'expired') and.push({ expireDate: { lt: today } });
  if (q.expiry === 'expiring') and.push({ expireDate: { gte: today, lte: addDays(today, EXPIRING_SOON_DAYS) } });
  if (q.expiry === 'valid') and.push({ expireDate: { gte: today } });

  if (and.length) where.AND = and;
  return where;
}
