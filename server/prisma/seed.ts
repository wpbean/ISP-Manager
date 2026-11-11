/**
 * Seeds demo data. Safe to re-run: wipes customers/payments, upserts staff users.
 *   npm run db:seed
 */
import { PrismaClient, type CustomerStatus, type PaymentMethod } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resyncCustomers } from '../src/services/network';

const prisma = new PrismaClient();

// Deterministic PRNG so the demo data is stable between runs.
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const AREAS = [
  { name: 'Mirpur', lat: 23.8223, lng: 90.3654 },
  { name: 'Uttara', lat: 23.8759, lng: 90.3795 },
  { name: 'Dhanmondi', lat: 23.7461, lng: 90.3742 },
  { name: 'Mohammadpur', lat: 23.7662, lng: 90.3589 },
  { name: 'Banani', lat: 23.7937, lng: 90.4066 },
  { name: 'Badda', lat: 23.7806, lng: 90.4265 },
] as const;
const FIRST = ['Rahim', 'Karim', 'Hasan', 'Imran', 'Sabbir', 'Nusrat', 'Farhana', 'Tanvir', 'Rakib', 'Sumaiya', 'Arif', 'Mehedi', 'Jannat', 'Shakib', 'Ayesha', 'Nayeem', 'Rubel', 'Sadia', 'Fahim', 'Tania'];
const LAST = ['Ahmed', 'Hossain', 'Islam', 'Rahman', 'Khan', 'Chowdhury', 'Uddin', 'Akter', 'Sarker', 'Mia'];
const PACKAGES = [
  { name: 'Basic 10', speed: '10 Mbps', fee: 500 },
  { name: 'Home 20', speed: '20 Mbps', fee: 800 },
  { name: 'Family 30', speed: '30 Mbps', fee: 1000 },
  { name: 'Pro 50', speed: '50 Mbps', fee: 1500 },
  { name: 'Ultra 100', speed: '100 Mbps', fee: 2500 },
] as const;
const COLORS = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua'];
const METHODS: PaymentMethod[] = ['CASH', 'CASH', 'BKASH', 'BKASH', 'NAGAD', 'ROCKET', 'BANK'];

const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

async function main() {
  const hash = await bcrypt.hash('admin12345', 10);
  const staffHash = await bcrypt.hash('staff12345', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@isp.local' },
    update: {},
    create: { name: 'System Admin', email: 'admin@isp.local', role: 'ADMIN', passwordHash: hash },
  });
  const staff = [
    { name: 'Office Manager', email: 'manager@isp.local', role: 'MANAGER' as const },
    { name: 'Field Technician', email: 'tech@isp.local', role: 'TECHNICIAN' as const },
    { name: 'Bill Collector', email: 'billing@isp.local', role: 'BILLING' as const },
  ];
  const users = [admin];
  for (const u of staff) {
    users.push(
      await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash: staffHash } }),
    );
  }
  const collectors = [admin, users[1]!, users[3]!];

  await prisma.payment.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.fiberNode.deleteMany(); // cables cascade

  const today = dateOnly(new Date());
  let paySeq = 0;

  for (let i = 1; i <= 64; i++) {
    const area = pick(AREAS);
    const pkg = pick(PACKAGES);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const connectedDaysAgo = int(20, 360);
    const connectionDate = addDays(today, -connectedDaysAgo);
    // Spread expiries: some expired, some expiring soon, most valid.
    const r = rand();
    const expireOffset = r < 0.15 ? -int(1, 40) : r < 0.3 ? int(0, 7) : int(8, 30);
    const expireDate = addDays(today, expireOffset);
    const status: CustomerStatus =
      i % 23 === 0 ? 'DISCONNECTED' : i % 17 === 0 ? 'PENDING' : expireOffset < -10 ? 'SUSPENDED' : 'ACTIVE';
    const pon = int(1, 8);

    const customer = await prisma.customer.create({
      data: {
        customerCode: `C-${String(i).padStart(6, '0')}`,
        seq: i,
        name,
        phone: `01${pick(['3', '5', '6', '7', '8', '9'])}${String(int(10000000, 99999999))}`,
        email: rand() < 0.4 ? `${name.split(' ')[0]!.toLowerCase()}${i}@gmail.com` : null,
        address: `House ${int(1, 120)}, Road ${int(1, 30)}, ${area.name}, Dhaka`,
        area: area.name,
        status,
        packageSpeed: pkg.speed,
        monthlyFee: pkg.fee,
        connectionDate,
        billingDate: expireDate,
        expireDate,
        radiusId: 24000 + i,
        pppoeUsername: `${name.split(' ')[0]!.toLowerCase()}${String(i).padStart(3, '0')}`,
        onuSerial: `HWTC${Math.floor(rand() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0')}`,
        onuModel: pick(['Huawei HG8010H', 'VSOL V2801RH', 'BDCOM P1501D1', 'ZTE F601']),
        ponId: pon,
        oltName: `OLT-${area.name.slice(0, 3).toUpperCase()}-01`,
        ponPort: `0/1/${pon}`,
        onuId: int(1, 64),
        splitterName: `SPL-${area.name.slice(0, 3).toUpperCase()}-${int(1, 12)}`,
        splitterRatio: pick(['1:8', '1:16', '1:16', '1:32']),
        splitterPort: int(1, 16),
        boxName: `TJ-${area.name.slice(0, 3).toUpperCase()}-${int(1, 30)}`,
        cableId: `CBL-${int(100, 999)}`,
        coreNumber: int(1, 24),
        coreColor: pick(COLORS),
        tubeColor: pick(COLORS.slice(0, 6)),
        rxPower: -Number((14 + rand() * 14).toFixed(2)),
        txPower: Number((1 + rand() * 2).toFixed(2)),
        cableLength: int(80, 2500),
        latitude: Number((area.lat + (rand() - 0.5) * 0.03).toFixed(6)),
        longitude: Number((area.lng + (rand() - 0.5) * 0.03).toFixed(6)),
        createdById: admin.id,
        createdAt: connectionDate,
      },
    });

    // Monthly payment history up to the current expiry.
    let periodTo = expireDate;
    for (let m = 0; m < Math.min(12, Math.floor(connectedDaysAgo / 30)); m++) {
      const periodFrom = new Date(Date.UTC(periodTo.getUTCFullYear(), periodTo.getUTCMonth() - 1, periodTo.getUTCDate() + 1));
      const paidAt = new Date(addDays(periodFrom, -int(0, 3)).getTime() + int(9, 20) * 3600000);
      if (paidAt > new Date() || paidAt < connectionDate) { periodTo = addDays(periodFrom, -1); continue; }
      paySeq++;
      const method = pick(METHODS);
      await prisma.payment.create({
        data: {
          seq: paySeq,
          receiptNo: `R${paidAt.getUTCFullYear()}-${String(paySeq).padStart(6, '0')}`,
          customerId: customer.id,
          amount: pkg.fee,
          method,
          transactionId: method === 'CASH' ? null : `TX${int(10000000, 99999999)}`,
          months: 1,
          periodFrom,
          periodTo,
          paidAt,
          collectedById: pick(collectors).id,
        },
      });
      periodTo = addDays(periodFrom, -1);
    }
  }

  const fiber = await seedFiberNetwork();

  // Keep autoincrement sequences ahead of the explicitly-set seq values.
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Customer"', 'seq'), (SELECT COALESCE(MAX(seq), 1) FROM "Customer"))`);
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Payment"', 'seq'), (SELECT COALESCE(MAX(seq), 1) FROM "Payment"))`);

  console.log(`Seeded ${users.length} users, 64 customers, ${paySeq} payments, fiber network (${fiber} customers patched).`);
  console.log('Login: admin@isp.local / admin12345  (staff: manager@ / tech@ / billing@isp.local — staff12345)');
}

/** Small demo PON in Mirpur: OLT → 2 TJ boxes → splitters (one cascaded) → customers. */
async function seedFiberNetwork() {
  const meters = (a: [number, number], b: [number, number]) => {
    const r = Math.PI / 180;
    const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)) * 1.15); // +15% slack
  };
  const P = {
    olt: [23.8223, 90.3654] as [number, number],
    tj1: [23.8268, 90.3611] as [number, number],
    tj2: [23.8175, 90.3712] as [number, number],
    sp3: [23.8148, 90.3752] as [number, number],
  };
  const node = (data: Parameters<typeof prisma.fiberNode.create>[0]['data']) => prisma.fiberNode.create({ data });
  const olt = await node({ type: 'OLT', name: 'OLT-MIR-01', ipAddress: '10.10.1.2', model: 'VSOL V1600G4', ponPorts: 8, ponPrefix: '0/1/', latitude: P.olt[0], longitude: P.olt[1], address: 'Mirpur-10 POP', posX: 0, posY: 0 });
  const tj1 = await node({ type: 'TJ_BOX', name: 'TJ-MIR-01', latitude: P.tj1[0], longitude: P.tj1[1], address: 'Section 11, pole #14', cablePorts: 4, posX: 440, posY: 0 });
  const tj2 = await node({ type: 'TJ_BOX', name: 'TJ-MIR-02', latitude: P.tj2[0], longitude: P.tj2[1], address: 'Section 2, pole #7', cablePorts: 4, posX: 440, posY: 300 });
  const sp1 = await node({ type: 'SPLITTER', name: 'SPL-MIR-01', splitterRatio: '1:8', boxId: tj1.id, posX: 880, posY: 0 });
  const sp2 = await node({ type: 'SPLITTER', name: 'SPL-MIR-02', splitterRatio: '1:8', boxId: tj2.id, posX: 880, posY: 300 });
  const sp3 = await node({ type: 'SPLITTER', name: 'SPL-MIR-03', splitterRatio: '1:4', latitude: P.sp3[0], longitude: P.sp3[1], address: 'Road 6 pole box', posX: 1440, posY: 560 });

  await prisma.fiberLink.createMany({
    data: [
      // CBL-101 is one 12-core cable carrying two PONs (cores 1 & 2) into TJ-MIR-01 positions 1 & 2.
      { fromNodeId: olt.id, fromPort: 1, toNodeId: tj1.id, toPort: 1, cableCode: 'CBL-101', coreCount: 12, tubeColor: 'Blue', coreNumber: 1, coreColor: 'Blue', length: meters(P.olt, P.tj1) },
      { fromNodeId: olt.id, fromPort: 3, toNodeId: tj1.id, toPort: 2, cableCode: 'CBL-101', coreCount: 12, tubeColor: 'Blue', coreNumber: 2, coreColor: 'Orange', length: meters(P.olt, P.tj1) },
      { fromNodeId: olt.id, fromPort: 2, toNodeId: tj2.id, toPort: 1, cableCode: 'CBL-102', coreCount: 12, tubeColor: 'Blue', coreNumber: 2, coreColor: 'Orange', length: meters(P.olt, P.tj2) },
      // PON 3 continues from TJ-MIR-01 position 2 to TJ-MIR-02 position 2.
      { fromNodeId: tj1.id, fromPort: 2, toNodeId: tj2.id, toPort: 2, cableCode: 'CBL-103', coreCount: 4, tubeColor: 'Blue', coreNumber: 1, coreColor: 'Blue', length: meters(P.tj1, P.tj2) },
      { fromNodeId: tj1.id, fromPort: 1, toNodeId: sp1.id, coreNumber: 1, coreColor: 'Blue', length: 2, notes: 'Patch inside box' },
      { fromNodeId: tj2.id, fromPort: 1, toNodeId: sp2.id, coreNumber: 2, coreColor: 'Orange', length: 2, notes: 'Patch inside box' },
      { fromNodeId: sp2.id, fromPort: 8, toNodeId: sp3.id, cableCode: 'CBL-201', coreCount: 2, coreNumber: 1, coreColor: 'Black', length: meters(P.tj2, P.sp3) },
    ],
  });

  const mirpur = await prisma.customer.findMany({ where: { area: 'Mirpur' }, orderBy: { seq: 'asc' }, select: { id: true } });
  const slots = [
    ...[1, 2, 3, 4, 5, 6, 7].map((port) => ({ nodeId: sp1.id, port })),
    ...[1, 2, 3, 4, 5, 6, 7].map((port) => ({ nodeId: sp2.id, port })),
    ...[1, 2, 3, 4].map((port) => ({ nodeId: sp3.id, port })),
  ];
  const patched = mirpur.slice(0, slots.length);
  for (const [i, c] of patched.entries()) {
    await prisma.customer.update({ where: { id: c.id }, data: { fiberNodeId: slots[i]!.nodeId, splitterPort: slots[i]!.port } });
  }
  await resyncCustomers();
  return patched.length;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
