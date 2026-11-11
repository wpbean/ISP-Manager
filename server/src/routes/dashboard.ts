import { Router } from 'express';
import { EXPIRING_SOON_DAYS, type DashboardStats } from '@isp/shared';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { addDays, fromDateOnly, todayDate } from '../lib/dates';
import { paymentInclude, serializePayment } from '../lib/serialize';
import { requirePermission } from '../middleware/auth';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', requirePermission('dashboard:read'), async (_req, res) => {
  const tz = env.timezone;
  const today = todayDate();
  const soon = addDays(today, EXPIRING_SOON_DAYS);
  const notDisconnected = { status: { not: 'DISCONNECTED' as const } };

  const [byStatus, total, expired, expiringSoonCount, expiringSoon, recent, revenueRows, monthlyRows, expected] =
    await Promise.all([
      prisma.customer.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.customer.count(),
      prisma.customer.count({ where: { ...notDisconnected, expireDate: { lt: today } } }),
      prisma.customer.count({ where: { ...notDisconnected, expireDate: { gte: today, lte: soon } } }),
      prisma.customer.findMany({
        where: { ...notDisconnected, expireDate: { gte: today, lte: soon } },
        orderBy: { expireDate: 'asc' },
        take: 8,
        select: { id: true, customerCode: true, name: true, phone: true, expireDate: true, monthlyFee: true, status: true },
      }),
      prisma.payment.findMany({ include: paymentInclude, orderBy: { paidAt: 'desc' }, take: 6 }),
      prisma.$queryRaw<{ this_month: number; last_month: number; today: number; new_this_month: number }[]>`
        WITH b AS (
          SELECT
            (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS m0,
            (date_trunc('month', (now() AT TIME ZONE ${tz}) - interval '1 month') AT TIME ZONE ${tz}) AS m1,
            (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS d0
        )
        SELECT
          COALESCE((SELECT SUM(amount) FROM "Payment", b WHERE "paidAt" >= b.m0), 0)::float AS this_month,
          COALESCE((SELECT SUM(amount) FROM "Payment", b WHERE "paidAt" >= b.m1 AND "paidAt" < b.m0), 0)::float AS last_month,
          COALESCE((SELECT SUM(amount) FROM "Payment", b WHERE "paidAt" >= b.d0), 0)::float AS today,
          (SELECT COUNT(*) FROM "Customer", b WHERE "createdAt" >= b.m0)::int AS new_this_month
      `,
      prisma.$queryRaw<{ month: string; collected: number; new_customers: number }[]>`
        WITH months AS (
          SELECT to_char(m, 'YYYY-MM') AS month
          FROM generate_series(
            date_trunc('month', now() AT TIME ZONE ${tz}) - interval '11 months',
            date_trunc('month', now() AT TIME ZONE ${tz}),
            interval '1 month'
          ) AS m
        ),
        pay AS (
          SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'YYYY-MM') AS month, SUM(amount)::float AS collected
          FROM "Payment" GROUP BY 1
        ),
        cust AS (
          SELECT to_char("createdAt" AT TIME ZONE ${tz}, 'YYYY-MM') AS month, COUNT(*)::int AS new_customers
          FROM "Customer" GROUP BY 1
        )
        SELECT months.month, COALESCE(pay.collected, 0)::float AS collected, COALESCE(cust.new_customers, 0)::int AS new_customers
        FROM months
        LEFT JOIN pay ON pay.month = months.month
        LEFT JOIN cust ON cust.month = months.month
        ORDER BY months.month
      `,
      prisma.customer.aggregate({ where: { status: 'ACTIVE' }, _sum: { monthlyFee: true } }),
    ]);

  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const rev = revenueRows[0]!;

  const stats: DashboardStats = {
    customers: {
      total,
      active: count('ACTIVE'),
      pending: count('PENDING'),
      suspended: count('SUSPENDED'),
      disconnected: count('DISCONNECTED'),
      expired,
      expiringSoon: expiringSoonCount,
      newThisMonth: rev.new_this_month,
    },
    revenue: {
      thisMonth: rev.this_month,
      lastMonth: rev.last_month,
      today: rev.today,
      expectedMonthly: Number(expected._sum.monthlyFee ?? 0),
    },
    monthly: monthlyRows.map((r) => ({ month: r.month, collected: r.collected, newCustomers: r.new_customers })),
    expiringSoon: expiringSoon.map((c) => ({ ...c, monthlyFee: Number(c.monthlyFee), expireDate: fromDateOnly(c.expireDate) })),
    recentPayments: recent.map(serializePayment),
  };
  res.json({ data: stats });
});
