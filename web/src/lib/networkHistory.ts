import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { FiberCustomer, FiberLink, FiberNetwork, FiberNode } from '@isp/shared';
import { api } from './api';

/**
 * Undo / redo for the network builder.
 *
 * Every network mutation records the graph before and after it. Undo puts back only the entities
 * that change touched (nodes, cores, positions, customer patching), so edits made since by
 * someone else are kept. The server has no "restore" endpoint, so a deleted node/core is
 * re-created with a new id; `alias` maps the old id to the live one so older history entries
 * keep pointing at the right thing.
 */
interface Entry {
  label: string;
  before: FiberNetwork;
  after: FiberNetwork;
}

const LIMIT = 100;
const NODE_FIELDS = ['name', 'latitude', 'longitude', 'address', 'ipAddress', 'model', 'ponPorts', 'ponPrefix', 'cablePorts', 'splitterRatio', 'boxId', 'notes'] as const;
const LINK_ENDS = ['fromNodeId', 'fromPort', 'toNodeId', 'toPort'] as const;
const LINK_FIELDS = ['cableCode', 'coreCount', 'tubeColor', 'coreNumber', 'coreColor', 'length', 'startMark', 'endMark', 'path', 'notes', 'spliceIn'] as const;
const TYPE_ORDER = { OLT: 0, TJ_BOX: 1, SPLITTER: 2 } as const;

let undoStack: Entry[] = [];
let redoStack: Entry[] = [];
let busy = false;
const alias = new Map<string, string>();
const listeners = new Set<() => void>();

const emit = () => {
  snapshot = { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, busy, undoLabel: undoStack.at(-1)?.label, redoLabel: redoStack.at(-1)?.label };
  listeners.forEach((l) => l());
};
let snapshot = { canUndo: false, canRedo: false, busy: false, undoLabel: undefined as string | undefined, redoLabel: undefined as string | undefined };

export function useNetworkHistory() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
}

/** The live id of something that may have been deleted and re-created by undo/redo. */
function resolve(id: string): string;
function resolve(id: string | null): string | null;
function resolve(id: string | null) {
  let cur = id;
  for (let i = 0; cur && alias.has(cur) && i < 1000; i++) cur = alias.get(cur)!;
  return cur;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nodeDiff = (a: FiberNode, b: FiberNode) => NODE_FIELDS.some((f) => !same(a[f], b[f]));
const posDiff = (a: FiberNode, b: FiberNode) => a.posX !== b.posX || a.posY !== b.posY;
const endsDiff = (a: FiberLink, b: FiberLink) => LINK_ENDS.some((f) => !same(a[f], b[f]));
const linkDiff = (a: FiberLink, b: FiberLink) => endsDiff(a, b) || LINK_FIELDS.some((f) => !same(a[f], b[f]));
const custDiff = (a: FiberCustomer | undefined, b: FiberCustomer | undefined) =>
  (a?.fiberNodeId ?? null) !== (b?.fiberNodeId ?? null) || (a?.splitterPort ?? null) !== (b?.splitterPort ?? null);

/** A snapshot rewritten to live ids. */
function canon(net: FiberNetwork): FiberNetwork {
  return {
    nodes: net.nodes.map((n) => ({ ...n, id: resolve(n.id), boxId: resolve(n.boxId) })),
    links: net.links.map((l) => ({ ...l, id: resolve(l.id), fromNodeId: resolve(l.fromNodeId), toNodeId: resolve(l.toNodeId) })),
    customers: net.customers.map((c) => ({ ...c, fiberNodeId: resolve(c.fiberNodeId) })),
  };
}

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

/** What `from → to` changed, as id sets. */
function touched(from: FiberNetwork, to: FiberNetwork) {
  const set = <T extends { id: string }>(a: T[], b: T[], diff: (x: T, y: T) => boolean) => {
    const ma = byId(a);
    const mb = byId(b);
    const ids = new Set<string>();
    for (const id of new Set([...ma.keys(), ...mb.keys()])) {
      const x = ma.get(id);
      const y = mb.get(id);
      if (!x || !y || diff(x, y)) ids.add(id);
    }
    return ids;
  };
  return {
    nodes: set(from.nodes, to.nodes, (a, b) => nodeDiff(a, b) || posDiff(a, b)),
    links: set(from.links, to.links, linkDiff),
    customers: set(from.customers, to.customers, (a, b) => custDiff(a, b)),
  };
}

/** `live` with the entities touched by `from → to` set to their state in `to`. */
function overlay(live: FiberNetwork, from: FiberNetwork, to: FiberNetwork): FiberNetwork {
  const t = touched(from, to);
  const pick = <T extends { id: string }>(liveXs: T[], toXs: T[], ids: Set<string>) => [
    ...liveXs.filter((x) => !ids.has(x.id)),
    ...toXs.filter((x) => ids.has(x.id)),
  ];
  // Devices: an edit and a move are separate, so undoing a rename keeps a later drag (and vice versa).
  const fromN = byId(from.nodes);
  const liveN = byId(live.nodes);
  const nodes = [
    ...live.nodes.filter((n) => !t.nodes.has(n.id)),
    ...to.nodes
      .filter((n) => t.nodes.has(n.id))
      .map((n) => {
        const x = fromN.get(n.id);
        const l = liveN.get(n.id);
        if (!x || !l) return n;
        let out = l;
        if (nodeDiff(x, n)) out = { ...out, ...Object.fromEntries(NODE_FIELDS.map((f) => [f, n[f]])) };
        if (posDiff(x, n)) out = { ...out, posX: n.posX, posY: n.posY };
        return out;
      }),
  ];
  return {
    nodes,
    links: pick(live.links, to.links, t.links),
    customers: pick(live.customers, to.customers, t.customers),
  };
}

const fetchNetwork = async () => (await api.get<{ data: FiberNetwork }>('/network')).data.data;

/** Makes the server match `target` (live ids), in an order the server's rules accept. */
async function apply(target: FiberNetwork) {
  let cur = await fetchNetwork();
  const want = { nodes: byId(target.nodes), links: byId(target.links), customers: new Map(target.customers.map((c) => [c.id, c])) };

  // 1. Unpatch customers that move or leave.
  for (const c of cur.customers) if (custDiff(c, want.customers.get(c.id))) await api.delete(`/network/assignments/${c.id}`);
  // 2. Remove cores that go away or whose ends change (ends can't be PATCHed).
  for (const l of cur.links) {
    const w = want.links.get(l.id);
    if (!w || endsDiff(l, { ...w, fromNodeId: resolve(w.fromNodeId), toNodeId: resolve(w.toNodeId) })) await api.delete(`/network/links/${l.id}`);
  }
  // 3. Remove devices (their remaining cores cascade).
  for (const n of cur.nodes) if (!want.nodes.has(n.id)) await api.delete(`/network/nodes/${n.id}`);

  cur = await fetchNetwork();
  const curNodes = byId(cur.nodes);
  // 4. Re-create devices: OLTs and boxes before the splitters that sit in them.
  for (const n of [...target.nodes].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type])) {
    if (curNodes.has(resolve(n.id))) continue;
    const { data } = await api.post<{ data: FiberNode }>('/network/nodes', {
      type: n.type,
      ...Object.fromEntries(NODE_FIELDS.map((f) => [f, f === 'boxId' ? resolve(n.boxId) : n[f]])),
      posX: n.posX,
      posY: n.posY,
    });
    alias.set(n.id, data.data.id);
  }
  // 5. Edit devices and positions.
  const moves: { id: string; x: number; y: number }[] = [];
  for (const n of target.nodes) {
    const c = curNodes.get(resolve(n.id));
    if (!c) continue;
    const w = { ...n, boxId: resolve(n.boxId) };
    if (nodeDiff(c, w)) {
      const body = Object.fromEntries(NODE_FIELDS.filter((f) => !same(c[f], w[f])).map((f) => [f, w[f]]));
      await api.patch(`/network/nodes/${c.id}`, body);
    }
    if (posDiff(c, n)) moves.push({ id: c.id, x: n.posX, y: n.posY });
  }
  if (moves.length) await api.patch('/network/positions', { positions: moves });

  // 6. Re-create cores, then edit the rest.
  const curLinks = byId((await fetchNetwork()).links);
  // Splices are unique per box position: release positions that change hands before re-assigning them.
  for (const l of target.links) {
    const c = curLinks.get(resolve(l.id));
    if (c && c.spliceIn != null && c.spliceIn !== l.spliceIn) {
      await api.patch(`/network/links/${c.id}`, { spliceIn: null });
      c.spliceIn = null;
    }
  }
  for (const l of target.links) {
    const c = curLinks.get(resolve(l.id));
    if (!c) {
      const { data } = await api.post<{ data: FiberLink }>('/network/links', {
        fromNodeId: resolve(l.fromNodeId),
        fromPort: l.fromPort,
        toNodeId: resolve(l.toNodeId),
        toPort: l.toPort,
        ...Object.fromEntries(LINK_FIELDS.map((f) => [f, l[f]])),
      });
      alias.set(l.id, data.data.id);
    } else if (LINK_FIELDS.some((f) => !same(c[f], l[f]))) {
      await api.patch(`/network/links/${c.id}`, Object.fromEntries(LINK_FIELDS.filter((f) => !same(c[f], l[f])).map((f) => [f, l[f]])));
    }
  }

  // 7. Patch customers back in.
  const now = new Map((await fetchNetwork()).customers.map((c) => [c.id, c]));
  for (const c of target.customers) {
    if (custDiff(now.get(c.id), c)) await api.post('/network/assignments', { customerId: c.id, nodeId: resolve(c.fiberNodeId), port: c.splitterPort });
  }
}

/** After a network change: the server's graph goes into the cache, customers refresh. */
async function refresh(qc: QueryClient) {
  qc.setQueryData(['network'], await fetchNetwork());
  qc.invalidateQueries({ queryKey: ['customers'] });
  qc.invalidateQueries({ queryKey: ['customer'] });
}

/** Runs a network mutation and records it for undo. */
export async function tracked<T>(qc: QueryClient, label: string, run: () => Promise<T>): Promise<T> {
  const before = qc.getQueryData<FiberNetwork>(['network']);
  const res = await run();
  let after: FiberNetwork | undefined;
  try {
    after = await fetchNetwork();
    qc.setQueryData(['network'], after);
  } catch {
    qc.invalidateQueries({ queryKey: ['network'] });
  }
  qc.invalidateQueries({ queryKey: ['customers'] });
  qc.invalidateQueries({ queryKey: ['customer'] });
  if (before && after) record(label, before, after);
  return res;
}

/** Records a change whose before/after are already known (e.g. optimistic position saves). */
export function record(label: string, before: FiberNetwork, after: FiberNetwork) {
  undoStack = [...undoStack, { label, before, after }].slice(-LIMIT);
  redoStack = [];
  emit();
}

async function step(qc: QueryClient, dir: 'undo' | 'redo'): Promise<string | null> {
  const stack = dir === 'undo' ? undoStack : redoStack;
  const entry = stack.at(-1);
  if (!entry || busy) return null;
  busy = true;
  emit();
  try {
    const live = await fetchNetwork();
    const before = canon(entry.before);
    const after = canon(entry.after);
    await apply(dir === 'undo' ? overlay(live, after, before) : overlay(live, before, after));
    if (dir === 'undo') {
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
    } else {
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
    }
    return entry.label;
  } finally {
    busy = false;
    await refresh(qc).catch(() => qc.invalidateQueries({ queryKey: ['network'] }));
    emit();
  }
}

export const undoNetwork = (qc: QueryClient) => step(qc, 'undo');
export const redoNetwork = (qc: QueryClient) => step(qc, 'redo');
