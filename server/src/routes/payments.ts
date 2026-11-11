import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { paymentCreateSchema, paymentListQuerySchema } from '@isp/shared';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/http';
import { paginate, paymentInclude, serializeCustomer, serializePayment } from '../lib/serialize';
import { addDays, todayStr, zonedDayStart } from '../lib/dates';
import { requirePermission } from '../middleware/auth';
import { computeRenewal, formatReceiptNo } from '../services/billing';

export const paymentsRouter = Router();

paymentsRouter.get('/', requirePermission('payments:read'), async (req, res) => {
  const q = paymentListQuerySchema.parse(req.query);
  const where: Prisma.PaymentWhereInput = {};
  if (q.customerId) where.customerId = q.customerId;
  if (q.method) where.method = q.method;
  if (q.from || q.to) {
    where.paidAt = {
      ...(q.from ? { gte: zonedDayStart(q.from) } : {}),
      ...(q.to ? { lt: addDays(zonedDayStart(q.to), 1) } : {}),
    };
  }
  if (q.q) {
    where.OR = [
      { receiptNo: { contains: q.q, mode: 'insensitive' } },
      { transactionId: { contains: q.q, mode: 'insensitive' } },
      { customer: { name: { contains: q.q, mode: 'insensitive' } } },
      { customer: { phone: { contains: q.q } } },
      { customer: { customerCode: { contains: q.q, mode: 'insensitive' } } },
    ];
  }

  const [total, sum, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { paidAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({
    data: rows.map(serializePayment),
    meta: { ...paginate(q.page, q.pageSize, total), totalAmount: Number(sum._sum.amount ?? 0) },
  });
});

/** Active staff who can be credited as collector (for the "Collected by" picker). */
paymentsRouter.get('/collectors', requirePermission('payments:create'), async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: users });
});

paymentsRouter.get('/:id', requirePermission('payments:read'), async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { id: String(req.params.id) }, include: paymentInclude });
  if (!p) throw notFound('Payment');
  res.json({ data: serializePayment(p) });
});

/** Record a payment. If months > 0 the customer's expiry/billing dates are extended. */
paymentsRouter.post('/', requirePermission('payments:create'), async (req, res) => {
  const input = paymentCreateSchema.parse(req.body);
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound('Customer');

  let collectedById = req.user!.id;
  if (input.collectedById && input.collectedById !== collectedById) {
    const collector = await prisma.user.findUnique({ where: { id: input.collectedById }, select: { isActive: true } });
    if (!collector?.isActive) throw badRequest('Collector must be an active staff member');
    collectedById = input.collectedById;
  }

  const renewal = input.months > 0 ? computeRenewal(customer, input.months) : null;
  // Backdated payments are stored at midday of that business day.
  const paidAt =
    input.paidAt && input.paidAt !== todayStr()
      ? new Date(zonedDayStart(input.paidAt).getTime() + 12 * 3600 * 1000)
      : new Date();

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        receiptNo: `tmp-${crypto.randomUUID()}`,
        customerId: customer.id,
        amount: input.amount,
        method: input.method,
        transactionId: input.transactionId ?? null,
        months: input.months,
        periodFrom: renewal?.periodFrom ?? null,
        periodTo: renewal?.periodTo ?? null,
        paidAt,
        note: input.note ?? null,
        collectedById,
      },
    });
    const payment = await tx.payment.update({
      where: { id: created.id },
      data: { receiptNo: formatReceiptNo(created.seq, paidAt) },
      include: paymentInclude,
    });
    const updatedCustomer = renewal
      ? await tx.customer.update({
          where: { id: customer.id },
          data: {
            expireDate: renewal.expireDate,
            billingDate: renewal.billingDate,
            // A paid renewal re-activates suspended / pending customers (not disconnected ones).
            ...(customer.status === 'SUSPENDED' || customer.status === 'PENDING' ? { status: 'ACTIVE' } : {}),
          },
        })
      : customer;
    return { payment, customer: updatedCustomer };
  });

  res.status(201).json({ data: serializePayment(result.payment), customer: serializeCustomer(result.customer) });
});

/**
 * Delete a payment. If it is the customer's most recent renewal, the expiry is rolled
 * back to the day before that payment's period started.
 */
paymentsRouter.delete('/:id', requirePermission('payments:delete'), async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });
  if (!payment) throw notFound('Payment');

  await prisma.$transaction(async (tx) => {
    if (payment.periodFrom && payment.periodTo) {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: payment.customerId } });
      if (customer.expireDate?.getTime() === payment.periodTo.getTime()) {
        const prev = addDays(payment.periodFrom, -1);
        await tx.customer.update({ where: { id: customer.id }, data: { expireDate: prev, billingDate: prev } });
      } else if (customer.expireDate && customer.expireDate > payment.periodTo) {
        throw badRequest('Only the latest renewal payment can be deleted. Delete newer payments first.');
      }
    }
    await tx.payment.delete({ where: { id: payment.id } });
  });
  res.status(204).end();
});
