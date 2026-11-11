import {
  DEFAULT_BOX_PORTS,
  cableKey,
  FIBER_HEX,
  ponLabel,
  splitterOutputs,
  type FiberCustomer,
  type FiberLink,
  type FiberNetwork,
  type FiberNode,
} from '@isp/shared';

export type LatLng = [number, number];

export const fiberHex = (color: string | null | undefined) =>
  color ? (FIBER_HEX as Record<string, string>)[color] ?? null : null;

/** Great-circle distance in meters. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const polylineM = (pts: LatLng[]) => pts.slice(1).reduce((sum, p, i) => sum + distanceM(pts[i]!, p), 0);

export const fmtLength = (m: number | null | undefined) =>
  m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

/** Number of output ports a node exposes on the schematic. */
export function outputPorts(n: FiberNode): number {
  if (n.type === 'OLT') return n.ponPorts ?? 0;
  if (n.type === 'SPLITTER') return splitterOutputs(n.splitterRatio) ?? 0;
  return n.cablePorts ?? DEFAULT_BOX_PORTS;
}

export function portName(n: FiberNode, port: number | null): string {
  if (port == null) return '';
  if (n.type === 'OLT') return `PON ${ponLabel(n.ponPrefix, port)}`;
  return n.type === 'TJ_BOX' ? `Out ${port}` : `P${port}`;
}

/** Cable sheath meter marks, e.g. "1200→1400 m" (null when neither is set). */
export function fmtMarks(l: Pick<FiberLink, 'startMark' | 'endMark'>): string | null {
  if (l.startMark == null && l.endMark == null) return null;
  return `${l.startMark ?? '?'}→${l.endMark ?? '?'} m`;
}

/** Indexed view of the network used by every builder view. */
export interface NetIndex {
  nodes: Map<string, FiberNode>;
  links: Map<string, FiberLink>;
  /** Cable leaving node `id` from port `p`: key `${id}:${p ?? ''}`. */
  outByPort: Map<string, FiberLink>;
  out: Map<string, FiberLink[]>;
  into: Map<string, FiberLink[]>;
  /** Core spliced into TJ box position `p`: key `${id}:${p}`. */
  inBySlot: Map<string, FiberLink>;
  /** Cores of each physical cable (see `cableKey`), sorted by core number. */
  cables: Map<string, FiberLink[]>;
  /** Customer on splitter port: key `${id}:${p}`. */
  custByPort: Map<string, FiberCustomer>;
  customers: Map<string, FiberCustomer>;
  splittersInBox: Map<string, FiberNode[]>;
}

export function indexNetwork(net: FiberNetwork): NetIndex {
  const ix: NetIndex = {
    nodes: new Map(net.nodes.map((n) => [n.id, n])),
    links: new Map(net.links.map((l) => [l.id, l])),
    outByPort: new Map(),
    out: new Map(),
    into: new Map(),
    inBySlot: new Map(),
    cables: new Map(),
    custByPort: new Map(),
    customers: new Map(net.customers.map((c) => [c.id, c])),
    splittersInBox: new Map(),
  };
  for (const l of net.links) {
    ix.outByPort.set(`${l.fromNodeId}:${l.fromPort ?? ''}`, l);
    ix.out.set(l.fromNodeId, [...(ix.out.get(l.fromNodeId) ?? []), l]);
    ix.into.set(l.toNodeId, [...(ix.into.get(l.toNodeId) ?? []), l]);
    if (l.toPort != null) ix.inBySlot.set(`${l.toNodeId}:${l.toPort}`, l);
    const k = cableKey(l);
    if (k) ix.cables.set(k, [...(ix.cables.get(k) ?? []), l]);
  }
  for (const cores of ix.cables.values()) cores.sort((a, b) => (a.coreNumber ?? 999) - (b.coreNumber ?? 999));
  for (const c of net.customers) if (c.splitterPort != null) ix.custByPort.set(`${c.fiberNodeId}:${c.splitterPort}`, c);
  for (const n of net.nodes)
    if (n.boxId) ix.splittersInBox.set(n.boxId, [...(ix.splittersInBox.get(n.boxId) ?? []), n]);
  return ix;
}

/** Where a node sits on the map: its own GPS, or for a splitter (which has no GPS of its own) its TJ box's GPS. */
export function nodePos(ix: NetIndex, n: FiberNode | undefined): LatLng | null {
  if (!n) return null;
  if (n.type === 'SPLITTER') {
    const box = n.boxId ? ix.nodes.get(n.boxId) : undefined;
    return box?.latitude != null && box.longitude != null ? [box.latitude, box.longitude] : null;
  }
  if (n.latitude != null && n.longitude != null) return [n.latitude, n.longitude];
  return null;
}

/** Next free default name like "OLT-01", "TJ-03", "SPL-12". */
export function nextName(nodes: FiberNode[], type: FiberNode['type']): string {
  const prefix = type === 'OLT' ? 'OLT' : type === 'TJ_BOX' ? 'TJ' : 'SPL';
  const taken = new Set(nodes.filter((n) => n.type === type).map((n) => n.name));
  for (let i = 1; ; i++) {
    const name = `${prefix}-${String(i).padStart(2, '0')}`;
    if (!taken.has(name)) return name;
  }
}

/** Every core of the physical cable `l` belongs to (just `[l]` when it has no cable ID). */
export function cableCores(ix: NetIndex, l: FiberLink): FiberLink[] {
  const k = cableKey(l);
  return (k && ix.cables.get(k)) || [l];
}

/** Lowest core number not yet used on a cable (null when the cable is full). */
export function nextFreeCore(cores: FiberLink[], coreCount: number | null | undefined): number | null {
  const used = new Set(cores.map((c) => c.coreNumber));
  for (let i = 1; i <= (coreCount ?? 1000); i++) if (!used.has(i)) return i;
  return null;
}

/** Free output ports of a node (no cable, no customer). */
export function freeOutPorts(ix: NetIndex, n: FiberNode): number[] {
  return Array.from({ length: outputPorts(n) }, (_, i) => i + 1).filter(
    (p) => !ix.outByPort.has(`${n.id}:${p}`) && !ix.custByPort.has(`${n.id}:${p}`),
  );
}

/** Free splice positions on a TJ box. */
export function freeInSlots(ix: NetIndex, n: FiberNode): number[] {
  if (n.type !== 'TJ_BOX') return [];
  return Array.from({ length: outputPorts(n) }, (_, i) => i + 1).filter((p) => !ix.inBySlot.has(`${n.id}:${p}`));
}

/** Short "where does this core come from" label, e.g. "OLT-01 · PON 0/1/2". */
export function sourceLabel(ix: NetIndex, l: FiberLink): string {
  const from = ix.nodes.get(l.fromNodeId);
  return from ? `${from.name}${l.fromPort != null ? ` · ${portName(from, l.fromPort)}` : ''}` : '—';
}
