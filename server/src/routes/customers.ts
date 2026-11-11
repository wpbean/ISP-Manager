import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  can,
  customerListQuerySchema,
  customerSchema,
  customerStatusSchema,
  customerUpdateSchema,
  CUSTOMER_STATUSES,
  NETWORK_FIELDS,
  type ImportResult,
} from '@isp/shared';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/http';
import { paginate, paymentInclude, serializeCustomer, serializePayment } from '../lib/serialize';
import { fromDateOnly } from '../lib/dates';
import { requirePermission } from '../middleware/auth';
import { buildCustomerWhere, formatCustomerCode, toCustomerData } from '../services/customers';

export const customersRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Column order for CSV export/import (headers = API field names). */
const CSV_COLUMNS = [
  'customerCode', 'name', 'phone', 'altPhone', 'email', 'nid', 'address', 'area', 'status',
  'packageSpeed', 'monthlyFee', 'connectionDate', 'billingDate', 'expireDate',
  'radiusId', 'pppoeUsername', 'onuSerial', 'onuModel', 'ponId',
  'oltName', 'ponPort', 'onuId', 'splitterName', 'splitterRatio', 'splitterPort', 'boxName',
  'cableId', 'coreNumber', 'coreColor', 'tubeColor', 'rxPower', 'txPower', 'cableLength',
  'latitude', 'longitude', 'notes',
] as const;

// ---- List ---------------------------------------------------------------
customersRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  const q = customerListQuerySchema.parse(req.query);
  const where = buildCustomerWhere(q);
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: q.sort === 'customerCode' ? { seq: q.order } : { [q.sort]: q.order },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({ data: rows.map(serializeCustomer), meta: paginate(q.page, q.pageSize, total) });
});

// ---- Map points (lightweight) --------------------------------------------
customersRouter.get('/map', requirePermission('customers:read'), async (req, res) => {
  const status = z.enum(CUSTOMER_STATUSES).optional().parse(req.query.status || undefined);
  const rows = await prisma.customer.findMany({
    where: { latitude: { not: null }, longitude: { not: null }, ...(status ? { status } : {}) },
    select: {
      id: true, customerCode: true, name: true, phone: true, status: true,
      expireDate: true, packageSpeed: true, latitude: true, longitude: true,
    },
  });
  res.json({ data: rows.map((r) => ({ ...r, expireDate: fromDateOnly(r.expireDate) })) });
});

// ---- Distinct areas (for filters / autocomplete) --------------------------
customersRouter.get('/areas', requirePermission('customers:read'), async (_req, res) => {
  const rows = await prisma.customer.findMany({
    where: { area: { not: null } },
    distinct: ['area'],
    select: { area: true },
    orderBy: { area: 'asc' },
  });
  res.json({ data: rows.map((r) => r.area) });
});

// ---- CSV export ---------------------------------------------------------
customersRouter.get('/export', requirePermission('customers:export'), async (req, res) => {
  const q = customerListQuerySchema.partial().parse(req.query);
  const rows = await prisma.customer.findMany({ where: buildCustomerWhere(q), orderBy: { seq: 'asc' } });
  const records = rows.map((r) => {
    const c = serializeCustomer(r) as unknown as Record<string, unknown>;
    return CSV_COLUMNS.map((col) => c[col] ?? '');
  });
  const csv = stringify([CSV_COLUMNS as unknown as string[], ...records]);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="customers-${stamp}.csv"`);
  res.send('﻿' + csv); // BOM so Excel opens UTF-8 correctly
});

// ---- CSV import ---------------------------------------------------------
// Rows with an existing customerCode are updated; others are created.
customersRouter.post('/import', requirePermission('customers:import'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Upload a CSV file in the "file" field');
  let rows: Record<string, string>[];
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    throw badRequest(`Could not parse CSV: ${(e as Error).message}`);
  }
  if (rows.length > 5000) throw badRequest('Maximum 5000 rows per import');

  const result: ImportResult = { created: 0, updated: 0, failed: [] };
  for (const [i, row] of rows.entries()) {
    const rowNo = i + 2; // +1 header, +1 one-based
    const { customerCode, ...fields } = row;
    if (fields.status) fields.status = fields.status.toUpperCase();
    const parsed = customerSchema.safeParse(fields);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      result.failed.push({ row: rowNo, message: `${issue?.path.join('.')}: ${issue?.message}` });
      continue;
    }
    try {
      const existing = customerCode ? await prisma.customer.findUnique({ where: { customerCode } }) : null;
      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data: toCustomerData(parsed.data) });
        result.updated++;
      } else {
        await createCustomer(parsed.data, req.user!.id);
        result.created++;
      }
    } catch (e) {
      const msg = (e as { code?: string }).code === 'P2002' ? 'Duplicate RADIUS ID, PPPoE username or ONU serial' : (e as Error).message;
      result.failed.push({ row: rowNo, message: msg });
    }
  }
  res.json(result);
});

// ---- Create -------------------------------------------------------------
async function createCustomer(data: z.output<typeof customerSchema>, userId: string) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        ...(toCustomerData(data) as object),
        customerCode: `tmp-${crypto.randomUUID()}`,
        createdById: userId,
      } as never,
    });
    return tx.customer.update({
      where: { id: created.id },
      data: { customerCode: formatCustomerCode(created.seq) },
    });
  });
}

customersRouter.post('/', requirePermission('customers:create'), async (req, res) => {
  const data = customerSchema.parse(req.body);
  const customer = await createCustomer(data, req.user!.id);
  res.status(201).json({ data: serializeCustomer(customer) });
});

// ---- Read ---------------------------------------------------------------
customersRouter.get('/:id', requirePermission('customers:read'), async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { id: String(req.params.id) } });
  if (!customer) throw notFound('Customer');
  res.json({ data: serializeCustomer(customer) });
});

customersRouter.get('/:id/payments', requirePermission('payments:read'), async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { customerId: String(req.params.id) },
    include: paymentInclude,
    orderBy: { paidAt: 'desc' },
  });
  res.json({ data: payments.map(serializePayment) });
});

// ---- Update -------------------------------------------------------------
customersRouter.patch(
  '/:id',
  requirePermission('customers:update', 'customers:update_network'),
  async (req, res) => {
    const data = customerUpdateSchema.parse(req.body);
    if (!can(req.user!.role, 'customers:update')) {
      // Technicians may only touch network / fiber / location fields.
      const disallowed = Object.keys(data).filter(
        (k) => !(NETWORK_FIELDS as readonly string[]).includes(k),
      );
      if (disallowed.length) throw forbidden(`You can only edit network fields (not: ${disallowed.join(', ')})`);
    }
    const customer = await prisma.customer.update({ where: { id: String(req.params.id) }, data: toCustomerData(data) });
    res.json({ data: serializeCustomer(customer) });
  },
);

customersRouter.patch('/:id/status', requirePermission('customers:update'), async (req, res) => {
  const { status } = customerStatusSchema.parse(req.body);
  const customer = await prisma.customer.update({ where: { id: String(req.params.id) }, data: { status } });
  res.json({ data: serializeCustomer(customer) });
});

// ---- Delete -------------------------------------------------------------
customersRouter.delete('/:id', requirePermission('customers:delete'), async (req, res) => {
  await prisma.customer.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});
