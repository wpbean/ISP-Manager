import type { Customer as DbCustomer, Payment as DbPayment, User as DbUser } from '@prisma/client';
import type { Customer, Payment, User } from '@isp/shared';
import { fromDateOnly } from './dates';

export function serializeUser(u: DbUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export function serializeCustomer(c: DbCustomer): Customer {
  const { seq: _seq, createdById: _cb, ...rest } = c;
  return {
    ...rest,
    monthlyFee: Number(c.monthlyFee),
    connectionDate: fromDateOnly(c.connectionDate),
    billingDate: fromDateOnly(c.billingDate),
    expireDate: fromDateOnly(c.expireDate),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

type DbPaymentWithRels = DbPayment & {
  customer?: Pick<DbCustomer, 'id' | 'customerCode' | 'name' | 'phone' | 'address' | 'packageSpeed'> | null;
  collectedBy?: Pick<DbUser, 'id' | 'name'> | null;
};

export function serializePayment(p: DbPaymentWithRels): Payment {
  return {
    id: p.id,
    receiptNo: p.receiptNo,
    customerId: p.customerId,
    customer: p.customer ?? undefined,
    amount: Number(p.amount),
    method: p.method,
    transactionId: p.transactionId,
    months: p.months,
    periodFrom: fromDateOnly(p.periodFrom),
    periodTo: fromDateOnly(p.periodTo),
    paidAt: p.paidAt.toISOString(),
    note: p.note,
    collectedBy: p.collectedBy ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export const paymentInclude = {
  customer: { select: { id: true, customerCode: true, name: true, phone: true, address: true, packageSpeed: true } },
  collectedBy: { select: { id: true, name: true } },
} as const;

export function paginate(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
