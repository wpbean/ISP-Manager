import { Prisma, type FiberLink as DbLink, type FiberNode as DbNode } from '@prisma/client';
import {
  CABLE_SHARED_FIELDS,
  DEFAULT_BOX_PORTS,
  fiberColorFor,
  ponLabel,
  splitterOutputs,
  type FiberCustomer,
  type FiberLink,
  type FiberLinkInput,
  type FiberNetwork,
  type FiberNode,
} from '@isp/shared';
import { prisma } from '../lib/prisma';
import { badRequest, HttpError, notFound } from '../lib/http';

// ---- Serialization ----------------------------------------------------------
export function serializeNode(n: DbNode): FiberNode {
  return { ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() };
}

export function serializeLink(l: DbLink): FiberLink {
  return {
    ...l,
    path: Array.isArray(l.path) ? (l.path as [number, number][]) : null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

const customerSelect = {
  id: true,
  customerCode: true,
  name: true,
  phone: true,
  status: true,
  latitude: true,
  longitude: true,
  rxPower: true,
  onuSerial: true,
  splitterPort: true,
  fiberNodeId: true,
} as const;

export async function loadNetwork(): Promise<FiberNetwork> {
  const [nodes, links, customers] = await Promise.all([
    prisma.fiberNode.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    prisma.fiberLink.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.customer.findMany({ where: { fiberNodeId: { not: null } }, select: customerSelect }),
  ]);
  return {
    nodes: nodes.map(serializeNode),
    links: links.map(serializeLink),
    customers: customers as FiberCustomer[],
  };
}

// ---- Validation helpers -----------------------------------------------------
export const duplicate = (msg: string) => new HttpError(409, msg, 'DUPLICATE');

/** Number of usable output ports on a node (null = unlimited / not port-based). */
export function portCount(n: Pick<DbNode, 'type' | 'ponPorts' | 'cablePorts' | 'splitterRatio'>): number | null {
  if (n.type === 'OLT') return n.ponPorts ?? null;
  if (n.type === 'TJ_BOX') return n.cablePorts ?? DEFAULT_BOX_PORTS;
  if (n.type === 'SPLITTER') return splitterOutputs(n.splitterRatio);
  return null;
}

export async function assertUniqueName(type: DbNode['type'], name: string, exceptId?: string) {
  const clash = await prisma.fiberNode.findFirst({ where: { type, name, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw duplicate(`Another ${type === 'TJ_BOX' ? 'TJ box' : type.toLowerCase()} is already named "${name}"`);
}

export async function assertBox(boxId: string | null | undefined) {
  if (!boxId) return;
  const box = await prisma.fiberNode.findUnique({ where: { id: boxId } });
  if (!box || box.type !== 'TJ_BOX') throw badRequest('boxId must reference a TJ box');
}

/** Reject shrinking a node's port count below ports that are in use. */
export async function assertPortsFit(nodeId: string, count: number | null) {
  if (count == null) return;
  const [link, spliced, customer] = await Promise.all([
    prisma.fiberLink.findFirst({ where: { fromNodeId: nodeId, fromPort: { gt: count } } }),
    prisma.fiberLink.findFirst({ where: { toNodeId: nodeId, toPort: { gt: count } } }),
    prisma.customer.findFirst({ where: { fiberNodeId: nodeId, splitterPort: { gt: count } } }),
  ]);
  if (link || spliced || customer) throw badRequest(`Ports above ${count} are still in use — disconnect them first`);
}

/** Port on `node` is free (no outgoing cable, no customer). */
async function assertPortFree(nodeId: string, port: number, exceptCustomerId?: string) {
  const [link, customer] = await Promise.all([
    prisma.fiberLink.findFirst({ where: { fromNodeId: nodeId, fromPort: port } }),
    prisma.customer.findFirst({
      where: { fiberNodeId: nodeId, splitterPort: port, ...(exceptCustomerId ? { id: { not: exceptCustomerId } } : {}) },
      select: { name: true },
    }),
  ]);
  if (link) throw duplicate(`Port ${port} already has a cable connected`);
  if (customer) throw duplicate(`Port ${port} is already used by ${customer.name}`);
}

export async function validateNewLink(input: FiberLinkInput & { fromPort?: number | null; toPort?: number | null }) {
  if (input.fromNodeId === input.toNodeId) throw badRequest('A cable cannot connect a node to itself');
  const [from, to] = await Promise.all([
    prisma.fiberNode.findUnique({ where: { id: input.fromNodeId } }),
    prisma.fiberNode.findUnique({ where: { id: input.toNodeId } }),
  ]);
  if (!from || !to) throw notFound('Node');
  if (to.type === 'OLT') throw badRequest('An OLT cannot be the downstream end of a cable');

  const fromPort = input.fromPort ?? null;
  const portWord = from.type === 'OLT' ? 'PON port' : from.type === 'TJ_BOX' ? 'cable out port' : 'output port';
  if (fromPort == null) throw badRequest(`Choose which ${portWord} the cable starts from`);
  const max = portCount(from);
  if (max != null && fromPort > max) throw badRequest(`${from.name} only has ${max} ports`);
  await assertPortFree(from.id, fromPort);

  let toPort: number | null = null;
  if (to.type === 'TJ_BOX') {
    // A TJ box takes many cores; each lands on its own splice position.
    toPort = input.toPort ?? null;
    if (toPort == null) throw badRequest(`Choose which splice position of ${to.name} the core lands on`);
    const slots = portCount(to);
    if (slots != null && toPort > slots) throw badRequest(`${to.name} only has ${slots} splice positions`);
    const taken = await prisma.fiberLink.findFirst({ where: { toNodeId: to.id, toPort } });
    if (taken) throw duplicate(`Position ${toPort} of ${to.name} already has a core spliced in`);
  } else if (to.type === 'SPLITTER') {
    const feed = await prisma.fiberLink.findFirst({ where: { toNodeId: to.id } });
    if (feed) throw duplicate(`${to.name} already has an input cable`);
  }

  // No loops: `to` must not already be upstream of `from`.
  const links = await prisma.fiberLink.findMany({ select: { fromNodeId: true, toNodeId: true } });
  const upstream = new Set<string>();
  const stack = [from.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (upstream.has(id)) continue;
    upstream.add(id);
    for (const l of links) if (l.toNodeId === id) stack.push(l.fromNodeId);
  }
  if (upstream.has(to.id)) throw badRequest('That connection would create a loop in the network');

  return { fromPort, toPort };
}

// ---- Multi-core cables --------------------------------------------------------
type CableRef = Pick<DbLink, 'fromNodeId' | 'toNodeId' | 'cableCode'>;
type SharedData = Partial<Pick<DbLink, (typeof CABLE_SHARED_FIELDS)[number]>>;

/** Other cores of the same physical cable (same cable ID between the same two nodes). */
export async function cableSiblings(ref: CableRef, exceptId?: string) {
  const code = ref.cableCode?.trim();
  if (!code) return [];
  return prisma.fiberLink.findMany({
    where: { fromNodeId: ref.fromNodeId, toNodeId: ref.toNodeId, cableCode: code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { coreNumber: 'asc' },
  });
}

/** A core number can be used once per cable, and must fit the cable's core count. */
export function assertCoreFits(siblings: DbLink[], coreNumber: number | null | undefined, coreCount: number | null | undefined, code: string | null) {
  if (coreNumber == null) return;
  if (coreCount != null && coreNumber > coreCount) throw badRequest(`Core #${coreNumber} is beyond the cable's ${coreCount} cores`);
  if (siblings.some((l) => l.coreNumber === coreNumber)) throw duplicate(`Core #${coreNumber} of cable ${code} is already in use`);
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Shared cable fields that differ between `next` and `prev`. */
export function sharedChanges(prev: SharedData, next: SharedData): SharedData {
  const out: Record<string, unknown> = {};
  for (const k of CABLE_SHARED_FIELDS) if (next[k] !== undefined && !sameValue(prev[k], next[k])) out[k] = next[k];
  return out as SharedData;
}

/** Shared cable fields as stored on a core (to copy onto a core joining that cable). */
export const sharedOf = (l: DbLink): SharedData =>
  Object.fromEntries(CABLE_SHARED_FIELDS.map((k) => [k, l[k]])) as SharedData;

/** Write shared cable fields to every other core of the cable. */
export async function syncCable(ref: CableRef, exceptId: string, data: SharedData) {
  const code = ref.cableCode?.trim();
  if (!code || !Object.keys(data).length) return;
  const { path, ...rest } = data;
  await prisma.fiberLink.updateMany({
    where: { fromNodeId: ref.fromNodeId, toNodeId: ref.toNodeId, cableCode: code, id: { not: exceptId } },
    data: { ...rest, ...(path !== undefined ? { path: path === null ? Prisma.DbNull : (path as Prisma.InputJsonValue) } : {}) },
  });
}

export async function validateAssignment(customerId: string, nodeId: string, port: number) {
  const node = await prisma.fiberNode.findUnique({ where: { id: nodeId } });
  if (!node) throw notFound('Splitter');
  if (node.type !== 'SPLITTER') throw badRequest('Customers can only be connected to a splitter output port');
  const max = portCount(node);
  if (max != null && port > max) throw badRequest(`${node.name} only has ${max} output ports`);
  await assertPortFree(nodeId, port, customerId);
}

// ---- Customer sync ----------------------------------------------------------
/**
 * Traces every patched customer back through splitters / TJ boxes to its OLT PON port
 * and writes the denormalised fiber fields on the customer (the ones shown on the customer
 * form and detail page). Only fields the builder knows are overwritten; nulls never clear data.
 */
export async function resyncCustomers() {
  const tx = prisma;
  const [nodes, links, customers] = await Promise.all([
    tx.fiberNode.findMany(),
    tx.fiberLink.findMany(),
    tx.customer.findMany({
      where: { fiberNodeId: { not: null } },
      select: {
        id: true,
        fiberNodeId: true,
        splitterPort: true,
        oltName: true,
        ponPort: true,
        splitterName: true,
        splitterRatio: true,
        boxName: true,
        coreColor: true,
      },
    }),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Splitters: their single input. TJ boxes: the core on each splice position (`${id}:${pos}`).
  const feed = new Map<string, DbLink>();
  for (const l of links) {
    const key = l.toPort != null ? `${l.toNodeId}:${l.toPort}` : l.toNodeId;
    if (!feed.has(key)) feed.set(key, l);
  }

  const traceCache = new Map<string, { oltName: string | null; ponPort: string | null; boxName: string | null }>();
  const trace = (splitterId: string) => {
    const hit = traceCache.get(splitterId);
    if (hit) return hit;
    const sp = byId.get(splitterId);
    let boxName = sp?.boxId ? (byId.get(sp.boxId)?.name ?? null) : null;
    let oltName: string | null = null;
    let ponPort: string | null = null;
    const seen = new Set<string>();
    let l = feed.get(splitterId);
    while (l && !seen.has(l.id)) {
      seen.add(l.id);
      const from = byId.get(l.fromNodeId);
      if (!from) break;
      if (from.type === 'OLT') {
        oltName = from.name;
        ponPort = l.fromPort != null ? ponLabel(from.ponPrefix, l.fromPort) : null;
        break;
      }
      if (from.type === 'TJ_BOX') {
        if (!boxName) boxName = from.name;
        // Core leaving "Out N" is spliced to the core that came in on position N.
        l = l.fromPort != null ? feed.get(`${from.id}:${l.fromPort}`) : undefined;
      } else l = feed.get(from.id);
    }
    const r = { oltName, ponPort, boxName };
    traceCache.set(splitterId, r);
    return r;
  };

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const c of customers) {
    const sp = byId.get(c.fiberNodeId!);
    if (!sp) continue;
    const t = trace(sp.id);
    const next = {
      oltName: t.oltName ?? c.oltName,
      ponPort: t.ponPort ?? c.ponPort,
      boxName: t.boxName ?? c.boxName,
      splitterName: sp.name,
      splitterRatio: sp.splitterRatio ?? c.splitterRatio,
      coreColor: c.splitterPort != null ? fiberColorFor(c.splitterPort) : c.coreColor,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== c[k]);
    if (changed) updates.push(tx.customer.update({ where: { id: c.id }, data: next }));
  }
  if (updates.length) await prisma.$transaction(updates);
}
