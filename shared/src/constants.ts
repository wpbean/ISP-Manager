// ---- Roles & permissions -------------------------------------------------
export const ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'BILLING'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  TECHNICIAN: 'Technician',
  BILLING: 'Billing / Collector',
};

export const PERMISSIONS = [
  'customers:read',
  'customers:create',
  'customers:update', // all customer fields
  'customers:update_network', // ONU / fiber / RADIUS / GPS fields only
  'customers:delete',
  'customers:import',
  'customers:export',
  'payments:read',
  'payments:create',
  'payments:delete',
  'dashboard:read',
  'network:read', // fiber builder (OLT / TJ box / splitter / cables)
  'network:manage',
  'users:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: PERMISSIONS.filter((p) => p !== 'users:manage'),
  TECHNICIAN: ['customers:read', 'customers:update_network', 'dashboard:read', 'network:read', 'network:manage'],
  BILLING: [
    'customers:read',
    'customers:export',
    'payments:read',
    'payments:create',
    'dashboard:read',
  ],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

// ---- Customers ----------------------------------------------------------
export const CUSTOMER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISCONNECTED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DISCONNECTED: 'Disconnected',
};

/** Fields a TECHNICIAN may edit (customers:update_network). */
export const NETWORK_FIELDS = [
  'radiusId',
  'pppoeUsername',
  'onuSerial',
  'onuModel',
  'ponId',
  'oltName',
  'ponPort',
  'onuId',
  'splitterName',
  'splitterRatio',
  'splitterPort',
  'boxName',
  'cableId',
  'coreNumber',
  'coreColor',
  'tubeColor',
  'rxPower',
  'txPower',
  'cableLength',
  'latitude',
  'longitude',
] as const;

export const FIBER_COLORS = [
  'Blue',
  'Orange',
  'Green',
  'Brown',
  'Slate',
  'White',
  'Red',
  'Black',
  'Yellow',
  'Violet',
  'Rose',
  'Aqua',
] as const;

export const SPLITTER_RATIOS = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'] as const;

/** Display hex for each TIA-598 fiber color (core / tube / splitter output). */
export const FIBER_HEX: Record<(typeof FIBER_COLORS)[number], string> = {
  Blue: '#1e6fd9',
  Orange: '#f08a24',
  Green: '#16a34a',
  Brown: '#8b5a2b',
  Slate: '#64748b',
  White: '#f5f5f5',
  Red: '#dc2626',
  Black: '#111111',
  Yellow: '#facc15',
  Violet: '#7c3aed',
  Rose: '#f472b6',
  Aqua: '#22d3ee',
};

/** Standard color of fiber/port N (1-based, repeats every 12). */
export const fiberColorFor = (n: number): (typeof FIBER_COLORS)[number] =>
  FIBER_COLORS[(((n - 1) % 12) + 12) % 12]!;

/** Output port count of a splitter ratio like "1:8" (null if unparseable). */
export function splitterOutputs(ratio: string | null | undefined): number | null {
  const m = /^\s*1\s*:\s*(\d+)\s*$/.exec(ratio ?? '');
  return m ? Math.min(Number(m[1]), 128) : null;
}

// ---- Fiber network (builder) ----------------------------------------------
export const FIBER_NODE_TYPES = ['OLT', 'TJ_BOX', 'SPLITTER'] as const;
export type FiberNodeType = (typeof FIBER_NODE_TYPES)[number];

export const FIBER_NODE_LABELS: Record<FiberNodeType, string> = {
  OLT: 'OLT',
  TJ_BOX: 'TJ box',
  SPLITTER: 'Splitter',
};

/** PON label of OLT port N, e.g. prefix "0/1/" + 4 → "0/1/4". */
export const ponLabel = (prefix: string | null | undefined, port: number) => `${prefix ?? ''}${port}`;

/** Default number of outgoing cable ports on a new TJ box. */
export const DEFAULT_BOX_PORTS = 4;
/**
 * Total port counts offered for a TJ box: 2, 4, 6 … 48. Half are In (left), half Out (right), so a
 * "4 port" box has 2 splice rows — stored `cablePorts` is the row count (= total / 2).
 */
export const TJ_BOX_PORT_OPTIONS = Array.from({ length: 24 }, (_, i) => (i + 1) * 2);

/** Cable run length from its sheath meter marks (either direction), or null. */
export const markLength = (start: number | null | undefined, end: number | null | undefined) =>
  start != null && end != null ? Math.abs(end - start) : null;

/**
 * Fields shared by every core of one physical cable. Cores with the same `cableCode` running
 * between the same two nodes are one multi-core cable; editing these on one core updates all.
 */
export const CABLE_SHARED_FIELDS = ['coreCount', 'length', 'startMark', 'endMark', 'path'] as const;

/** Key grouping cores into one physical cable (null when the core has no cable ID). */
export const cableKey = (l: { fromNodeId: string; toNodeId: string; cableCode: string | null }) =>
  l.cableCode?.trim() ? `${l.fromNodeId}>${l.toNodeId}>${l.cableCode.trim()}` : null;

export const CABLE_CORE_COUNTS = [1, 2, 4, 6, 8, 12, 24, 48, 96] as const;

// ---- Payments -----------------------------------------------------------
export const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'ROCKET', 'BANK', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  ROCKET: 'Rocket',
  BANK: 'Bank',
  OTHER: 'Other',
};

// ---- Misc ---------------------------------------------------------------
export const CURRENCY = { code: 'BDT', symbol: '৳', locale: 'en-BD' } as const;

/** Customers whose expiry is within this many days count as "expiring soon". */
export const EXPIRING_SOON_DAYS = 7;

/** One billing month = this many days. A renewal of N months extends expiry by N × 30 days. */
export const BILLING_CYCLE_DAYS = 30;
