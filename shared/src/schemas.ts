import { z } from 'zod';
import {
  CUSTOMER_STATUSES,
  FIBER_NODE_TYPES,
  PAYMENT_METHODS,
  ROLES,
} from './constants';

// Helpers: forms send "" for empty inputs — normalise to null.
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

const optStr = (max = 191) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

const optNum = (min?: number, max?: number) => {
  let n = z.coerce.number({ error: 'Must be a number' });
  if (min !== undefined) n = n.min(min);
  if (max !== undefined) n = n.max(max);
  return z.preprocess(emptyToNull, n.nullable()).optional();
};

const optInt = (min = 0, max?: number) => {
  let n = z.coerce.number({ error: 'Must be a number' }).int('Must be a whole number').min(min);
  if (max !== undefined) n = n.max(max);
  return z.preprocess(emptyToNull, n.nullable()).optional();
};

/** Accepts "YYYY-MM-DD" or full ISO string; output is "YYYY-MM-DD". */
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date')
  .transform((s) => s.slice(0, 10));

const optDate = z.preprocess(emptyToNull, dateStr.nullable()).optional();

// ---- Auth ---------------------------------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'At least 8 characters'),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---- Users (staff) ------------------------------------------------------
const userBase = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: optStr(30),
  role: z.enum(ROLES),
  isActive: z.boolean(),
});

export const userCreateSchema = userBase.extend({
  password: z.string().min(8, 'At least 8 characters'),
  isActive: z.boolean().default(true),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

// NB: built from a default-free base — in zod 4, .default() still fires inside .partial().
export const userUpdateSchema = userBase
  .partial()
  .extend({ password: z.preprocess(emptyToNull, z.string().min(8, 'At least 8 characters').nullable()).optional() });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

// ---- Customers ----------------------------------------------------------
const customerBase = z.object({
  // Basic
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone: z
    .string()
    .trim()
    .min(6, 'Phone is required')
    .max(30)
    .regex(/^[+\d][\d\s-]*$/, 'Invalid phone number'),
  altPhone: optStr(30),
  email: z.preprocess(emptyToNull, z.string().trim().email().nullable()).optional(),
  nid: optStr(40),
  address: z.string().trim().min(3, 'Address is required').max(500),
  area: optStr(100),
  status: z.enum(CUSTOMER_STATUSES),

  // Service & billing
  packageSpeed: z.string().trim().min(1, 'Speed is required').max(50),
  monthlyFee: z.coerce.number().min(0, 'Must be ≥ 0').max(10_000_000),
  connectionDate: optDate,
  billingDate: optDate,
  expireDate: optDate,

  // Network / RADIUS / ONU
  radiusId: optInt(1, 2_147_483_647),
  pppoeUsername: optStr(100),
  onuSerial: optStr(100),
  onuModel: optStr(100),
  ponId: optInt(0, 1024),

  // Fiber — OLT & PON
  oltName: optStr(100),
  ponPort: optStr(30),
  onuId: optInt(0, 4096),
  // Fiber — splitter & box
  splitterName: optStr(100),
  splitterRatio: optStr(10),
  splitterPort: optInt(0, 256),
  boxName: optStr(100),
  // Fiber — cable & core
  cableId: optStr(100),
  coreNumber: optInt(0, 1000),
  coreColor: optStr(30),
  tubeColor: optStr(30),
  // Fiber — signal & distance
  rxPower: optNum(-60, 20),
  txPower: optNum(-60, 20),
  cableLength: optInt(0, 200_000),

  // Location
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),

  notes: optStr(2000),
});

export const customerSchema = customerBase.extend({
  status: z.enum(CUSTOMER_STATUSES).default('ACTIVE'),
});
export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerData = z.output<typeof customerSchema>;

// NB: built from the default-free base so a PATCH never silently resets `status`.
export const customerUpdateSchema = customerBase.partial();

export const customerStatusSchema = z.object({ status: z.enum(CUSTOMER_STATUSES) });

export const customerListQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  /** expired = expireDate < today; expiring = within EXPIRING_SOON_DAYS */
  expiry: z.enum(['expired', 'expiring', 'valid']).optional(),
  area: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z
    .enum(['createdAt', 'name', 'expireDate', 'billingDate', 'monthlyFee', 'customerCode'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

// ---- Payments -----------------------------------------------------------
export const paymentCreateSchema = z.object({
  customerId: z.string().min(1),
  amount: z.coerce.number().positive('Amount must be > 0').max(10_000_000),
  method: z.enum(PAYMENT_METHODS).default('CASH'),
  transactionId: optStr(100),
  /** Months of service this payment covers; 0 = no renewal (e.g. partial / due payment). */
  months: z.coerce.number().int().min(0).max(24).default(1),
  paidAt: optDate,
  note: optStr(500),
  /** Staff user who collected the money. Defaults to the logged-in user. */
  collectedById: optStr(64),
});
export type PaymentCreateInput = z.input<typeof paymentCreateSchema>;

export const paymentListQuerySchema = z.object({
  customerId: z.string().optional(),
  q: z.string().trim().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: optDate,
  to: optDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

// ---- Fiber network (builder) ----------------------------------------------
const fiberNodeBase = z.object({
  type: z.enum(FIBER_NODE_TYPES),
  name: z.string().trim().min(1, 'Name is required').max(100),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  address: optStr(300),
  // OLT
  ipAddress: optStr(100),
  model: optStr(100),
  ponPorts: optInt(1, 128),
  ponPrefix: optStr(20),
  // TJ box
  cablePorts: optInt(1, 48),
  // Splitter
  splitterRatio: optStr(10),
  boxId: optStr(64),
  notes: optStr(2000),
  posX: z.coerce.number().optional(),
  posY: z.coerce.number().optional(),
});

export const fiberNodeCreateSchema = fiberNodeBase;
export type FiberNodeInput = z.input<typeof fiberNodeCreateSchema>;
// Type is fixed after creation.
export const fiberNodeUpdateSchema = fiberNodeBase.omit({ type: true }).partial();
export type FiberNodeUpdateInput = z.input<typeof fiberNodeUpdateSchema>;

export const fiberPositionsSchema = z.object({
  positions: z
    .array(z.object({ id: z.string().min(1), x: z.number().finite(), y: z.number().finite() }))
    .max(2000),
});

const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

const fiberLinkBase = z.object({
  fromNodeId: z.string().min(1),
  fromPort: optInt(1, 128),
  toNodeId: z.string().min(1),
  /** TJ box target only: splice position the core lands on (continues out on the same-numbered port). */
  toPort: optInt(1, 128),
  cableCode: optStr(100),
  coreCount: optInt(1, 1000),
  tubeColor: optStr(30),
  coreNumber: optInt(1, 1000),
  coreColor: optStr(30),
  length: optInt(0, 200_000),
  /** Meter mark printed on the cable sheath at the start (from) and end (to) of this run. */
  startMark: optInt(0, 1_000_000),
  endMark: optInt(0, 1_000_000),
  path: z.array(latLng).max(500).nullable().optional(),
  notes: optStr(2000),
});

export const fiberLinkCreateSchema = fiberLinkBase;
export type FiberLinkInput = z.input<typeof fiberLinkCreateSchema>;
// Endpoints are fixed after creation — delete and redraw to re-route.
export const fiberLinkUpdateSchema = fiberLinkBase.omit({ fromNodeId: true, fromPort: true, toNodeId: true, toPort: true }).partial();
export type FiberLinkUpdateInput = z.input<typeof fiberLinkUpdateSchema>;

export const fiberAssignSchema = z.object({
  customerId: z.string().min(1),
  nodeId: z.string().min(1),
  port: z.coerce.number().int().min(1).max(128),
});
export type FiberAssignInput = z.input<typeof fiberAssignSchema>;
