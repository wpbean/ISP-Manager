import { Prisma, type FiberLink as DbLink, type FiberNode as DbNode } from '@prisma/client';
import {
  CABLE_SHARED_FIELDS,
  DEFAULT_BOX_PORTS,
  fiberColorFor,
  markLength,
  ponLabel,
  splitterOutputs,
  type FiberCustomer,
  type FiberInsertBoxData,
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

// ---- Insert a TJ box into an existing cable ---------------------------------
type LatLng = [number, number];

function nodeLatLng(n: DbNode | null | undefined, byId: Map<string, DbNode>): LatLng | null {
  if (!n) return null;
  const at = n.type === 'SPLITTER' && n.boxId ? byId.get(n.boxId) : n;
  return at?.latitude != null && at.longitude != null ? [at.latitude, at.longitude] : null;
}

/**
 * Split a cable's map waypoints where the box sits: waypoints before the closest route segment
 * go to the first run, the rest to the second. Without GPS on all three points the route is
 * kept on the first run (it can be redrawn).
 */
export function splitPath(path: LatLng[] | null, a: LatLng | null, box: LatLng | null, b: LatLng | null): [LatLng[] | null, LatLng[] | null] {
  if (!path?.length) return [null, null];
  if (!a || !b || !box) return [path, null];
  const k = Math.cos((box[0] * Math.PI) / 180);
  const xy = (p: LatLng) => [p[1] * k, p[0]] as const;
  const pts = [a, ...path, b].map(xy);
  const [px, py] = xy(box);
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < pts.length - 1; j++) {
    const [x1, y1] = pts[j]!;
    const [x2, y2] = pts[j + 1]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const d = (x1 + t * dx - px) ** 2 + (y1 + t * dy - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  const first = path.slice(0, best);
  const second = path.slice(best);
  return [first.length ? first : null, second.length ? second : null];
}

/** Nodes downstream of `start` (following cables), using `links`. */
function downstream(start: string, links: Pick<DbLink, 'fromNodeId' | 'toNodeId'>[]) {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of links) if (l.fromNodeId === id) stack.push(l.toNodeId);
  }
  return seen;
}

export async function insertBoxIntoCable(linkId: string, input: FiberInsertBoxData) {
  const cur = await prisma.fiberLink.findUnique({ where: { id: linkId } });
  if (!cur) throw notFound('Cable');
  const cores = (input.wholeCable ?? true) && cur.cableCode?.trim()
    ? [cur, ...(await cableSiblings(cur, cur.id))].sort((x, y) => (x.coreNumber ?? 0) - (y.coreNumber ?? 0))
    : [cur];
  const coreIds = new Set(cores.map((c) => c.id));

  const nodes = await prisma.fiberNode.findMany();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const a = byId.get(cur.fromNodeId);
  const b = byId.get(cur.toNodeId);
  if (!a || !b) throw notFound('Node');

  // ---- The box: existing or new.
  let box: DbNode | null = null;
  let newBox: (Prisma.FiberNodeCreateInput & { cablePorts: number }) | null = null;
  if (input.boxId) {
    box = byId.get(input.boxId) ?? null;
    if (!box || box.type !== 'TJ_BOX') throw badRequest('Choose a TJ box to insert');
    if (box.id === a.id || box.id === b.id) throw badRequest(`The cable already ends at ${box.name}`);
    // No loops: after the cut, A → box → B must not close a circle.
    const links = (await prisma.fiberLink.findMany({ select: { id: true, fromNodeId: true, toNodeId: true } })).filter((l) => !coreIds.has(l.id));
    if (downstream(box.id, links).has(a.id) || downstream(b.id, links).has(box.id))
      throw badRequest(`Putting ${box.name} on this cable would create a loop in the network`);
  } else if (input.newBox) {
    const nb = input.newBox;
    await assertUniqueName('TJ_BOX', nb.name);
    newBox = {
      type: 'TJ_BOX',
      name: nb.name,
      latitude: nb.latitude ?? null,
      longitude: nb.longitude ?? null,
      address: nb.address ?? null,
      notes: nb.notes ?? null,
      cablePorts: Math.max(nb.cablePorts ?? DEFAULT_BOX_PORTS, cores.length),
      posX: nb.posX ?? 0,
      posY: nb.posY ?? 0,
    };
  } else throw badRequest('Choose a TJ box or create a new one');

  // ---- A splice position N per core: In N free and Out N free.
  const slots: number[] = [];
  const total = box ? portCount(box)! : newBox!.cablePorts;
  if (box) {
    const [ins, outs] = await Promise.all([
      prisma.fiberLink.findMany({ where: { toNodeId: box.id }, select: { toPort: true } }),
      prisma.fiberLink.findMany({ where: { fromNodeId: box.id }, select: { fromPort: true } }),
    ]);
    const used = new Set([...ins.map((l) => l.toPort), ...outs.map((l) => l.fromPort)]);
    for (let p = 1; p <= total && slots.length < cores.length; p++) if (!used.has(p)) slots.push(p);
  } else for (let p = 1; p <= cores.length; p++) slots.push(p);
  if (slots.length < cores.length)
    throw badRequest(`${box!.name} has only ${slots.length} free splice position${slots.length === 1 ? '' : 's'} — ${cores.length} needed`);

  // ---- Meter marks and lengths of the two runs (shared by every core of the cable).
  const { mark, lengthToBox } = input;
  if (mark != null && cur.startMark != null && cur.endMark != null) {
    const [lo, hi] = [Math.min(cur.startMark, cur.endMark), Math.max(cur.startMark, cur.endMark)];
    if (mark < lo || mark > hi) throw badRequest(`Meter mark ${mark} is outside this cable's run (${cur.startMark}–${cur.endMark})`);
  }
  const end1 = mark ?? null;
  const start2 = mark ?? null;
  const len1 = lengthToBox ?? markLength(cur.startMark, end1);
  const len2 =
    markLength(start2, cur.endMark) ?? (cur.length != null && len1 != null ? Math.max(0, cur.length - len1) : null);

  const boxPos: LatLng | null = box
    ? nodeLatLng(box, byId)
    : newBox!.latitude != null && newBox!.longitude != null ? [newBox!.latitude, newBox!.longitude] : null;
  const [path1, path2] = splitPath(
    Array.isArray(cur.path) ? (cur.path as LatLng[]) : null,
    nodeLatLng(a, byId),
    boxPos,
    nodeLatLng(b, byId),
  );
  const json = (p: LatLng[] | null) => (p ? (p as Prisma.InputJsonValue) : Prisma.DbNull);

  const result = await prisma.$transaction(async (tx) => {
    const target = box ?? (await tx.fiberNode.create({ data: newBox! }));
    const created: DbLink[] = [];
    for (const [i, core] of cores.entries()) {
      const pos = slots[i]!;
      // First run: A → box, landing on splice position N (frees B's input for the second run).
      await tx.fiberLink.update({
        where: { id: core.id },
        data: { toNodeId: target.id, toPort: pos, endMark: end1, length: len1, path: json(path1) },
      });
      // Second run: box Out N → B, same cable ID / core / colors.
      created.push(
        await tx.fiberLink.create({
          data: {
            fromNodeId: target.id,
            fromPort: pos,
            toNodeId: core.toNodeId,
            toPort: core.toPort,
            cableCode: core.cableCode,
            coreCount: core.coreCount,
            tubeColor: core.tubeColor,
            coreNumber: core.coreNumber,
            coreColor: core.coreColor,
            startMark: start2,
            endMark: core.endMark,
            length: len2,
            path: json(path2),
          },
        }),
      );
    }
    return { box: target, created };
  });
  await resyncCustomers();
  return { box: serializeNode(result.box), links: result.created.map(serializeLink) };
}
