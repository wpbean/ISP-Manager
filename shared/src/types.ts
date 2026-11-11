import type { CustomerStatus, FiberNodeType, PaymentMethod, Role } from './constants';

/** API response shapes (dates are ISO strings / "YYYY-MM-DD" for date-only). */

export interface ApiError {
  error: { message: string; code?: string; details?: unknown };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  nid: string | null;
  address: string;
  area: string | null;
  status: CustomerStatus;

  packageSpeed: string;
  monthlyFee: number;
  connectionDate: string | null;
  billingDate: string | null;
  expireDate: string | null;

  radiusId: number | null;
  pppoeUsername: string | null;
  onuSerial: string | null;
  onuModel: string | null;
  ponId: number | null;

  oltName: string | null;
  ponPort: string | null;
  onuId: number | null;
  splitterName: string | null;
  splitterRatio: string | null;
  splitterPort: number | null;
  boxName: string | null;
  cableId: string | null;
  coreNumber: number | null;
  coreColor: string | null;
  tubeColor: string | null;
  rxPower: number | null;
  txPower: number | null;
  cableLength: number | null;

  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  /** Splitter (fiber builder) this customer is patched into; port = splitterPort. */
  fiberNodeId: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CustomerMapPoint {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  status: CustomerStatus;
  expireDate: string | null;
  packageSpeed: string;
  latitude: number;
  longitude: number;
}

export interface Payment {
  id: string;
  receiptNo: string;
  customerId: string;
  customer?: Pick<Customer, 'id' | 'customerCode' | 'name' | 'phone' | 'address' | 'packageSpeed'>;
  amount: number;
  method: PaymentMethod;
  transactionId: string | null;
  months: number;
  periodFrom: string | null;
  periodTo: string | null;
  paidAt: string;
  note: string | null;
  collectedBy: Pick<User, 'id' | 'name'> | null;
  createdAt: string;
}

export interface DashboardStats {
  customers: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    disconnected: number;
    expired: number;
    expiringSoon: number;
    newThisMonth: number;
  };
  revenue: {
    thisMonth: number;
    lastMonth: number;
    today: number;
    expectedMonthly: number;
  };
  monthly: { month: string; collected: number; newCustomers: number }[];
  expiringSoon: Pick<Customer, 'id' | 'customerCode' | 'name' | 'phone' | 'expireDate' | 'monthlyFee' | 'status'>[];
  recentPayments: Payment[];
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: { row: number; message: string }[];
}

/** Active staff member who can be credited with collecting a payment. */
export type Collector = Pick<User, 'id' | 'name' | 'role'>;

// ---- Fiber network (builder) ----------------------------------------------
export interface FiberNode {
  id: string;
  type: FiberNodeType;
  name: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  ipAddress: string | null;
  model: string | null;
  ponPorts: number | null;
  ponPrefix: string | null;
  /** TJ box: splice positions (in N → out N). */
  cablePorts: number | null;
  splitterRatio: string | null;
  boxId: string | null;
  notes: string | null;
  posX: number;
  posY: number;
  createdAt: string;
  updatedAt: string;
}

export interface FiberLink {
  id: string;
  fromNodeId: string;
  fromPort: number | null;
  toNodeId: string;
  /** TJ box target: splice position (core continues out on the same-numbered port). */
  toPort: number | null;
  cableCode: string | null;
  coreCount: number | null;
  tubeColor: string | null;
  coreNumber: number | null;
  coreColor: string | null;
  length: number | null;
  /** Cable sheath meter marks at the from / to end. */
  startMark: number | null;
  endMark: number | null;
  path: [number, number][] | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Customer patched into a splitter output port. */
export type FiberCustomer = Pick<
  Customer,
  'id' | 'customerCode' | 'name' | 'phone' | 'status' | 'latitude' | 'longitude' | 'rxPower' | 'onuSerial' | 'splitterPort'
> & { fiberNodeId: string };

export interface FiberNetwork {
  nodes: FiberNode[];
  links: FiberLink[];
  customers: FiberCustomer[];
}
