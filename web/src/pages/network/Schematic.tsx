import { memo, useCallback, useEffect, useImperativeHandle, type DragEvent, type Ref } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { clsx } from 'clsx';
import { Box, ChevronDown, ChevronRight, MapPin, Plus, Server, Split } from 'lucide-react';
import { fiberColorFor, ponLabel, type FiberCustomer, type FiberNetwork, type FiberNode, type FiberNodeType } from '@isp/shared';
import { useTheme } from '@/lib/theme';
import { fiberHex, fmtLength, fmtMarks, nodePos, outputPorts, type NetIndex } from '@/lib/fiber';
import { STATUS_COLORS } from '@/components/MapTiles';
import { TOUCH_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { DND_TYPE, type Selection } from './types';

// Fixed geometry so customer leaves line up with splitter port rows.
export const NODE_W = 236;
export const HEADER_H = 58;
export const ROW_H = 24;
export const PAD = 6;
const LEAF_GAP = 64;
/** Splitters-inside strip at the bottom of a TJ box. */
const BOX_FOOT_H = 34;
/** One-line notes strip under a TJ box header (only when it has notes). */
const BOX_NOTE_H = 26;
/** Expanded TJ box: splitters are drawn nested inside, inset from the box edges. */
const NEST_INSET = 20;
const NEST_GAP = 14;
/** Handle radius (size-2.5 = 10px): React Flow reports edge endpoints at the handle's outer edge. */
const HANDLE_R = 5;
const NEST_ADD_H = 30;
export const NESTED_W = NODE_W - NEST_INSET * 2;

/** Collapsed height (TJ boxes without their nested splitter area). */
export function nodeHeight(n: FiberNode): number {
  const ports = outputPorts(n);
  if (n.type === 'TJ_BOX') return HEADER_H + (n.notes?.trim() ? BOX_NOTE_H : 0) + PAD * 2 + ports * ROW_H + BOX_FOOT_H + 2;
  return HEADER_H + (ports ? PAD * 2 + ports * ROW_H : 0);
}

/** Splitters installed in a TJ box, in a stable order. */
export function boxSplitters(ix: NetIndex, boxId: string): FiberNode[] {
  return [...(ix.splittersInBox.get(boxId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Height of the nested-splitter area of an expanded TJ box. */
function nestedAreaH(splitters: FiberNode[], canManage: boolean): number {
  if (!splitters.length && !canManage) return 0;
  return NEST_GAP + splitters.reduce((h, s) => h + nodeHeight(s) + NEST_GAP, 0) + (canManage ? NEST_ADD_H + NEST_GAP : 0);
}

/** On-canvas height of any node, honouring the expanded state of TJ boxes. */
export function displayHeight(n: FiberNode, ix: NetIndex, expanded: ReadonlySet<string>, canManage: boolean): number {
  const base = nodeHeight(n);
  return n.type === 'TJ_BOX' && expanded.has(n.id) ? base + nestedAreaH(boxSplitters(ix, n.id), canManage) : base;
}

/** The TJ box a splitter is drawn inside (null for free-standing splitters and other nodes). */
export function nestBox(ix: NetIndex, n: FiberNode | undefined): FiberNode | null {
  if (n?.type !== 'SPLITTER' || !n.boxId) return null;
  const box = ix.nodes.get(n.boxId);
  return box?.type === 'TJ_BOX' ? box : null;
}

// ---- Node components -------------------------------------------------------
type NodeData = {
  node: FiberNode;
  ix: NetIndex;
  /** Splitter drawn inside its TJ box. */
  nested?: boolean;
  /** TJ box: nested splitters shown. */
  expanded?: boolean;
  canManage?: boolean;
  onToggle?: (boxId: string) => void;
  onAddSplitter?: (boxId: string) => void;
  onSelectNode?: (id: string) => void;
};
type FiberFlowNode = Node<NodeData, 'olt' | 'box' | 'splitter'>;
type LeafNode = Node<{ customer: FiberCustomer }, 'customer'>;

const TYPE_ICON: Record<FiberNodeType, typeof Server> = { OLT: Server, TJ_BOX: Box, SPLITTER: Split };

function Shell({
  node,
  ix,
  selected,
  children,
  sub,
  width = NODE_W,
  nested,
  action,
}: {
  node: FiberNode;
  ix: NetIndex;
  selected: boolean;
  children?: React.ReactNode;
  sub: React.ReactNode;
  width?: number;
  nested?: boolean;
  action?: React.ReactNode;
}) {
  const Icon = TYPE_ICON[node.type];
  const hasGps = nodePos(ix, node) != null;
  return (
    <div
      style={{ width }}
      className={clsx(
        'rounded-lg border text-left transition-colors',
        nested ? 'bg-surface-2' : 'bg-surface shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-hairline hover:border-surface-3',
      )}
    >
      <div className="flex items-center gap-2.5 px-3" style={{ height: HEADER_H }}>
        <span
          className={clsx(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            node.type === 'OLT' ? 'bg-primary text-on-primary' : nested ? 'bg-surface text-accent' : 'bg-surface-2 text-accent',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="num truncate text-[13px] font-semibold text-strong">{node.name}</p>
          <p className="truncate text-[11px] text-muted">{sub}</p>
        </div>
        {action}
        {!nested && (
          <MapPin
            className={clsx('size-3.5 shrink-0', hasGps ? 'text-up' : 'text-surface-3')}
            aria-label={hasGps ? 'Has GPS location' : 'No GPS location'}
          />
        )}
      </div>
      {children}
    </div>
  );
}

const handleCls = '!size-2.5 !border-2 !border-surface';
const handleBg = { background: 'var(--muted-strong)' };

function PortRows({ node, ix }: NodeData) {
  const count = outputPorts(node);
  if (!count) return null;
  return (
    <div className="border-t border-hairline" style={{ paddingTop: PAD, paddingBottom: PAD }}>
      {Array.from({ length: count }, (_, i) => {
        const port = i + 1;
        const link = ix.outByPort.get(`${node.id}:${port}`);
        const cust = ix.custByPort.get(`${node.id}:${port}`);
        const target = link ? ix.nodes.get(link.toNodeId) : undefined;
        const color = node.type === 'SPLITTER' ? fiberHex(fiberColorFor(port)) : null;
        const isBox = node.type === 'TJ_BOX';
        const inLink = isBox ? ix.inBySlot.get(`${node.id}:${port}`) : undefined;
        const inFrom = inLink ? ix.nodes.get(inLink.fromNodeId) : undefined;
        const used = !!(link || cust);
        return (
          <div key={port} className={clsx('relative flex items-center gap-2 text-[11px]', isBox ? 'pr-6 pl-3' : 'px-3')} style={{ height: ROW_H }}>
            {isBox ? (
              // Splice position: core in on the left continues out on the right.
              <Handle
                type="target"
                id={`i${port}`}
                position={Position.Left}
                className={handleCls}
                style={{ background: inLink ? (fiberHex(inLink.coreColor) ?? '#0ecb81') : 'var(--muted-strong)' }}
              />
            ) : color ? (
              <span className="size-2.5 shrink-0 rounded-full ring-1 ring-hairline" style={{ background: color }} />
            ) : (
              <span className={clsx('size-1.5 shrink-0 rounded-full', used ? 'bg-up' : 'bg-surface-3')} />
            )}
            <span className={clsx('num shrink-0 text-muted-strong', isBox ? 'w-4' : 'w-12')}>
              {node.type === 'OLT' ? ponLabel(node.ponPrefix, port) : isBox ? port : `P${port}`}
            </span>
            {isBox && (
              <span className={clsx('num min-w-0 flex-1 truncate', inFrom ? 'text-strong' : 'text-muted')} title={inFrom ? `In: ${inFrom.name}${inLink?.cableCode ? ` · ${inLink.cableCode}` : ''}${inLink?.coreNumber != null ? ` core #${inLink.coreNumber}` : ''}` : undefined}>
                {inFrom ? <>← {inFrom.name}{inLink?.coreNumber != null && <span className="text-muted"> #{inLink.coreNumber}</span>}</> : '—'}
              </span>
            )}
            <span className={clsx('num min-w-0 flex-1 truncate text-right', used ? 'text-strong' : 'text-muted')}>
              {target ? <>→ {target.name}</> : cust ? '' : 'free'}
            </span>
            <Handle
              type="source"
              id={`p${port}`}
              position={Position.Right}
              className={handleCls}
              style={{ background: color ?? (used ? '#0ecb81' : 'var(--muted-strong)') }}
            />
          </div>
        );
      })}
    </div>
  );
}

const OltNode = memo(function OltNode({ data, selected }: NodeProps<FiberFlowNode>) {
  const n = data.node;
  const uplink = data.ix.into.get(n.id)?.[0];
  const upFrom = uplink ? data.ix.nodes.get(uplink.fromNodeId) : undefined;
  const info = [n.ipAddress, n.model].filter(Boolean).join(' · ') || `${n.ponPorts ?? 0} PON ports`;
  return (
    <Shell
      node={n}
      ix={data.ix}
      selected={selected}
      sub={upFrom ? <>uplink ← {upFrom.name} Out {uplink!.fromPort ?? ''} · {info}</> : info}
    >
      {/* Uplink input: one core from a TJ box out port (backbone side). */}
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        className={handleCls}
        title={upFrom ? `Uplink from ${upFrom.name}` : 'Uplink — drag a TJ box out port here'}
        style={{ ...handleBg, ...(uplink ? { background: fiberHex(uplink.coreColor) ?? '#0ecb81' } : {}), top: HEADER_H / 2 }}
      />
      <PortRows {...data} />
    </Shell>
  );
});

const BoxNode = memo(function BoxNode({ data, selected }: NodeProps<FiberFlowNode>) {
  const n = data.node;
  const note = n.notes?.trim();
  const splitters = boxSplitters(data.ix, n.id);
  const expanded = !!data.expanded;
  const sources = [...new Set((data.ix.into.get(n.id) ?? []).map((l) => data.ix.nodes.get(l.fromNodeId)?.name).filter(Boolean))];
  const sub = sources.length ? `in ← ${sources.join(', ')}` : n.address || 'Joint / distribution box';
  const area = expanded ? nestedAreaH(splitters, !!data.canManage) : 0;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <Shell node={n} ix={data.ix} selected={selected} sub={sub}>
      {note && (
        <div
          style={{ height: BOX_NOTE_H }}
          className="flex items-center border-t border-hairline px-3 text-[11px] text-muted-strong"
          title={note}
        >
          <span className="truncate">{note}</span>
        </div>
      )}
      <PortRows {...data} />
      <div style={{ height: BOX_FOOT_H }} className="relative flex items-center gap-1.5 border-t border-hairline pr-3 pl-1.5 text-[11px] text-muted">
        {/* Collapsed: cables to/from hidden splitters attach here. */}
        <Handle type="target" id="spl-in" position={Position.Left} isConnectable={false} className={handleCls} style={{ ...handleBg, opacity: expanded ? 0 : 1 }} />
        <button
          type="button"
          onClick={stop(() => data.onToggle?.(n.id))}
          className="nodrag flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-muted-strong hover:bg-surface-2 hover:text-strong"
          aria-expanded={expanded}
          title={expanded ? 'Collapse splitters' : 'Expand to see and manage splitters'}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Split className="size-3.5 text-accent" />
          <span className="num">{splitters.length}</span>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {expanded ? (
            <span className="truncate">{splitters.length ? 'Splitters inside' : 'No splitters inside'}</span>
          ) : splitters.length ? (
            splitters.map((s) => {
              const total = outputPorts(s);
              const used = Array.from({ length: total }, (_, i) => i + 1).filter(
                (p) => data.ix.custByPort.has(`${s.id}:${p}`) || data.ix.outByPort.has(`${s.id}:${p}`),
              ).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={stop(() => data.onSelectNode?.(s.id))}
                  title={`${s.name} · ${s.splitterRatio ?? '—'} · ${used}/${total} ports used`}
                  className="nodrag num shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-muted-strong hover:text-strong"
                >
                  {s.name} <span className="text-muted">{used}/{total}</span>
                </button>
              );
            })
          ) : (
            <span className="truncate">No splitters inside</span>
          )}
        </div>
        <Handle type="source" id="spl-out" position={Position.Right} isConnectable={false} className={handleCls} style={{ ...handleBg, opacity: expanded ? 0 : 1 }} />
      </div>
      {area > 0 && (
        <div style={{ height: area }} className="relative border-t border-hairline bg-canvas/40">
          {data.canManage && (
            <button
              type="button"
              onClick={stop(() => data.onAddSplitter?.(n.id))}
              style={{ left: NEST_INSET, right: NEST_INSET, bottom: NEST_GAP, height: NEST_ADD_H }}
              className="nodrag absolute flex items-center justify-center gap-1.5 rounded-md border border-dashed border-hairline text-[12px] font-medium text-muted-strong hover:border-primary hover:text-strong"
            >
              <Plus className="size-3.5" /> Add splitter
            </button>
          )}
        </div>
      )}
    </Shell>
  );
});

const SplitterNode = memo(function SplitterNode({ data, selected }: NodeProps<FiberFlowNode>) {
  const n = data.node;
  const box = n.boxId ? data.ix.nodes.get(n.boxId) : undefined;
  const feed = data.ix.into.get(n.id)?.[0];
  const feedFrom = feed ? data.ix.nodes.get(feed.fromNodeId) : undefined;
  // Nested: the box is obvious, so say what feeds it instead.
  const where = data.nested
    ? feed && feedFrom
      ? ` · ← ${feedFrom.id === n.boxId ? '' : `${feedFrom.name} `}${feedFrom.type === 'TJ_BOX' ? 'Out' : feedFrom.type === 'OLT' ? 'PON' : 'P'} ${feed.fromPort ?? ''}`
      : ' · not fed'
    : box
      ? ` · in ${box.name}`
      : '';
  return (
    <Shell node={n} ix={data.ix} selected={selected} nested={data.nested} width={data.nested ? NESTED_W : NODE_W} sub={<>{n.splitterRatio ?? '—'}{where}</>}>
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        className={handleCls}
        style={{ ...handleBg, ...(feed ? { background: fiberHex(feed.coreColor) ?? '#0ecb81' } : {}), top: HEADER_H / 2 }}
      />
      <PortRows {...data} />
    </Shell>
  );
});

const CustomerLeaf = memo(function CustomerLeaf({ data, selected }: NodeProps<LeafNode>) {
  const c = data.customer;
  return (
    <div
      className={clsx(
        'flex w-[176px] items-center gap-2 rounded-full border bg-surface-2 px-2.5 text-[11px]',
        selected ? 'border-primary' : 'border-hairline',
      )}
      style={{ height: ROW_H - 4, marginTop: 2 }}
      title={`${c.name} · ${c.customerCode}`}
    >
      <Handle type="target" id="in" position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[c.status] }} />
      <span className="min-w-0 flex-1 truncate text-strong">{c.name}</span>
      {c.rxPower != null && <span className={clsx('num shrink-0', c.rxPower < -27 ? 'text-down' : 'text-muted')}>{c.rxPower.toFixed(1)}</span>}
    </div>
  );
});

const nodeTypes = { olt: OltNode, box: BoxNode, splitter: SplitterNode, customer: CustomerLeaf };

// ---- Edge ------------------------------------------------------------------
/** Very dark / very light cores (Black, White) vanish on one theme: give them a visible sheath. */
function casingFor(color: string | null): string {
  if (!color || !color.startsWith('#') || color.length !== 7) return 'var(--surface-3)';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.12 || lum > 0.9 ? 'var(--muted)' : 'var(--surface-3)';
}

/** Orthogonal polyline with rounded corners. */
function roundedPath(pts: [number, number][], r = 6): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const rin = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px), uy = Math.sign(y - py);
    const vx = Math.sign(nx - x), vy = Math.sign(ny - y);
    d += ` L ${x - ux * rin} ${y - uy * rin} Q ${x} ${y} ${x + vx * rin} ${y + vy * rin}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/**
 * Cable inside an expanded TJ box (box Out N → nested splitter, or nested splitter → nested splitter).
 * Routed like a cable tray: right gutter → gap above the target splitter → left gutter → splitter input,
 * so it never leaves the box or crosses a splitter.
 */
type InternalEdgeT = Edge<{ color: string | null; fromBox: boolean; lane: number; title: string }, 'internal'>;

const LANES = [0, -3, 3];

function InternalEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<InternalEdgeT>) {
  const lane = LANES[(data?.lane ?? 0) % LANES.length];
  // Box edges, recovered from the handle positions.
  const boxRight = data?.fromBox ? sourceX - HANDLE_R : sourceX - HANDLE_R + NEST_INSET;
  const boxLeft = targetX + HANDLE_R - NEST_INSET;
  const rx = boxRight - NEST_INSET / 2 + lane;
  const lx = boxLeft + NEST_INSET / 2 - lane;
  const gapY = targetY - HEADER_H / 2 - NEST_GAP / 2;
  const path = roundedPath([
    [sourceX, sourceY],
    [rx, sourceY],
    [rx, gapY],
    [lx, gapY],
    [lx, targetY],
    [targetX, targetY],
  ]);
  const color = selected ? '#FCD535' : (data?.color ?? 'var(--muted-strong)');
  return (
    <>
      <path d={path} fill="none" stroke={selected ? 'var(--surface-3)' : casingFor(data?.color ?? null)} strokeWidth={4.5} strokeLinejoin="round" />
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? 2.5 : 2 }} interactionWidth={10} />
      <title>{data?.title}</title>
    </>
  );
}

type FiberEdgeT = Edge<{ linkId: string; label: string | null; color: string | null; onSelect: (id: string) => void }, 'fiber'>;

function FiberEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FiberEdgeT>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = selected ? '#FCD535' : (data?.color ?? 'var(--muted-strong)');
  return (
    <>
      <path d={path} fill="none" stroke={selected ? 'var(--surface-3)' : casingFor(data?.color ?? null)} strokeWidth={6} strokeLinecap="round" />
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? 3 : 2.5 }} interactionWidth={18} />
      {data?.label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={() => data.onSelect(data.linkId)}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            className={clsx(
              'nodrag nopan num pointer-events-auto absolute rounded-md border px-1.5 py-0.5 text-[10px] whitespace-nowrap',
              selected ? 'border-primary bg-surface text-strong' : 'border-hairline bg-surface text-muted-strong hover:text-strong',
            )}
          >
            {data.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { fiber: FiberEdge, internal: InternalEdge };

// ---- Graph building --------------------------------------------------------
const FLOW_TYPE: Record<FiberNodeType, FiberFlowNode['type']> = { OLT: 'olt', TJ_BOX: 'box', SPLITTER: 'splitter' };

interface BuildOpts {
  ix: NetIndex;
  sel: Selection | null;
  canManage: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (boxId: string) => void;
  onAddSplitter: (boxId: string) => void;
  onSelectNode: (id: string) => void;
}

/** Collapsed TJ box a node is hidden in (nested splitter of a collapsed box). */
function hiddenIn(ix: NetIndex, expanded: ReadonlySet<string>, id: string): string | null {
  const box = nestBox(ix, ix.nodes.get(id));
  return box && !expanded.has(box.id) ? box.id : null;
}

function buildNodes(net: FiberNetwork, o: BuildOpts): Node[] {
  const { ix, sel, canManage, expanded } = o;
  const top: Node[] = [];
  const children: Node[] = [];
  const shared = { ix, canManage, onToggle: o.onToggle, onAddSplitter: o.onAddSplitter, onSelectNode: o.onSelectNode };
  for (const n of net.nodes) {
    const box = nestBox(ix, n);
    if (box) continue; // placed below with its box
    top.push({
      id: n.id,
      type: FLOW_TYPE[n.type],
      position: { x: n.posX, y: n.posY },
      data: { node: n, ...shared, expanded: expanded.has(n.id) } satisfies NodeData,
      draggable: canManage,
      selected: sel?.kind === 'node' && sel.id === n.id,
    });
    // Splitters inside an expanded box: stacked under the box's splice rows, moving with the box.
    if (n.type !== 'TJ_BOX' || !expanded.has(n.id)) continue;
    let y = nodeHeight(n) + NEST_GAP;
    for (const s of boxSplitters(ix, n.id)) {
      children.push({
        id: s.id,
        type: 'splitter',
        parentId: n.id,
        position: { x: NEST_INSET, y },
        data: { node: s, ...shared, nested: true } satisfies NodeData,
        draggable: false,
        selected: sel?.kind === 'node' && sel.id === s.id,
      });
      y += nodeHeight(s) + NEST_GAP;
    }
  }
  // Customers hang off their splitter port as child nodes (move with the splitter).
  const leaves: Node[] = [];
  for (const c of net.customers) {
    const sp = ix.nodes.get(c.fiberNodeId);
    if (!sp || c.splitterPort == null || hiddenIn(ix, expanded, sp.id)) continue;
    leaves.push({
      id: `cust:${c.id}`,
      type: 'customer',
      parentId: c.fiberNodeId,
      position: { x: (nestBox(ix, sp) ? NESTED_W : NODE_W) + LEAF_GAP, y: HEADER_H + PAD + (c.splitterPort - 1) * ROW_H },
      data: { customer: c },
      draggable: false,
      connectable: false,
      selected: sel?.kind === 'customer' && sel.id === c.id,
    });
  }
  // Parents must come before their children.
  return [...top, ...children, ...leaves];
}

function buildEdges(net: FiberNetwork, ix: NetIndex, sel: Selection | null, expanded: ReadonlySet<string>, onSelect: (id: string) => void): Edge[] {
  const edges: Edge[] = [];
  const lanes = new Map<string, number>();
  for (const l of net.links) {
    const from = ix.nodes.get(l.fromNodeId);
    const to = ix.nodes.get(l.toNodeId);
    const parts = [l.cableCode, l.coreNumber != null ? `#${l.coreNumber}` : null, fmtMarks(l), l.length != null ? fmtLength(l.length) : null].filter(Boolean);
    // Cable that stays inside one TJ box (box Out → own splitter, splitter → splitter in the same box).
    const toBox = nestBox(ix, to)?.id;
    const fromBox = from?.type === 'TJ_BOX' ? from.id : nestBox(ix, from)?.id;
    if (toBox && toBox === fromBox) {
      if (!expanded.has(toBox)) continue; // folded away; shown as "← Out N" / port labels
      const lane = lanes.get(toBox) ?? 0;
      lanes.set(toBox, lane + 1);
      const fromLabel = from?.type === 'TJ_BOX' ? `Out ${l.fromPort ?? 1}` : `${from?.name} P${l.fromPort ?? 1}`;
      edges.push({
        id: l.id,
        type: 'internal',
        source: l.fromNodeId,
        sourceHandle: `p${l.fromPort ?? 1}`,
        target: l.toNodeId,
        targetHandle: 'in',
        zIndex: 1,
        selected: sel?.kind === 'link' && sel.id === l.id,
        data: {
          color: fiberHex(l.coreColor),
          fromBox: from?.type === 'TJ_BOX',
          lane,
          title: [`${fromLabel} → ${to?.name}`, ...parts].join(' · '),
        },
      } satisfies InternalEdgeT);
      continue;
    }
    const srcBox = hiddenIn(ix, expanded, l.fromNodeId);
    const dstBox = hiddenIn(ix, expanded, l.toNodeId);
    // Both ends folded into the same collapsed box.
    if ((srcBox ?? l.fromNodeId) === (dstBox ?? l.toNodeId)) continue;
    edges.push({
      id: l.id,
      type: 'fiber',
      source: srcBox ?? l.fromNodeId,
      sourceHandle: srcBox ? 'spl-out' : `p${l.fromPort ?? 1}`,
      target: dstBox ?? l.toNodeId,
      targetHandle: dstBox ? 'spl-in' : to?.type === 'TJ_BOX' ? `i${l.toPort ?? 1}` : 'in',
      selected: sel?.kind === 'link' && sel.id === l.id,
      data: {
        linkId: l.id,
        label: parts.length ? parts.join(' · ') : null,
        color: fiberHex(l.coreColor),
        onSelect,
        ...(srcBox && from ? { label: [from.name, ...parts].join(' · ') } : {}),
      },
    } satisfies FiberEdgeT);
  }
  for (const c of net.customers) {
    if (c.splitterPort == null || !ix.nodes.has(c.fiberNodeId) || hiddenIn(ix, expanded, c.fiberNodeId)) continue;
    edges.push({
      id: `drop:${c.id}`,
      source: c.fiberNodeId,
      sourceHandle: `p${c.splitterPort}`,
      target: `cust:${c.id}`,
      targetHandle: 'in',
      type: 'straight',
      selectable: false,
      focusable: false,
      style: { stroke: fiberHex(fiberColorFor(c.splitterPort)) ?? undefined, strokeWidth: 2, strokeDasharray: '4 3' },
    });
  }
  return edges;
}

// ---- Canvas ----------------------------------------------------------------
export interface SchematicApi {
  center: () => { x: number; y: number };
  fitView: () => void;
  focus: (nodeId: string) => void;
}

export interface LinkDraft {
  fromNodeId: string;
  fromPort: number | null;
  toNodeId: string;
  /** TJ box target: splice position. */
  toPort?: number | null;
  /** Pre-select an existing cable (add another core to it). */
  cableCode?: string | null;
}

interface Props {
  net: FiberNetwork;
  ix: NetIndex;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  canManage: boolean;
  onConnect: (draft: LinkDraft) => void;
  /** `boxId` when a splitter is dropped onto a TJ box. */
  onCreateAt: (type: FiberNodeType, pos: { x: number; y: number }, boxId?: string) => void;
  onMoved: (positions: { id: string; x: number; y: number }[]) => void;
  /** TJ boxes whose splitters are shown. */
  expanded: ReadonlySet<string>;
  onToggleBox: (boxId: string) => void;
  onAddSplitter: (boxId: string) => void;
  apiRef: Ref<SchematicApi>;
  /** Phone / portrait tablet: drop the minimap to free up the canvas. */
  compact?: boolean;
}

function Canvas({ net, ix, selection, onSelect, canManage, onConnect, onCreateAt, onMoved, expanded, onToggleBox, onAddSplitter, apiRef, compact }: Props) {
  const touch = useMediaQuery(TOUCH_QUERY);
  const { theme } = useTheme();
  const rf = useReactFlow();
  const selectLink = useCallback((id: string) => onSelect({ kind: 'link', id }), [onSelect]);
  const selectNode = useCallback((id: string) => onSelect({ kind: 'node', id }), [onSelect]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(
    () =>
      setNodes((prev) => {
        // Keep measured sizes so rebuilt nodes don't flash while React Flow re-measures them.
        const measured = new Map(prev.map((n) => [n.id, n.measured]));
        const built = buildNodes(net, { ix, sel: selection, canManage, expanded, onToggle: onToggleBox, onAddSplitter, onSelectNode: selectNode });
        // Boxes change height when expanded/collapsed: let React Flow re-measure those.
        return built.map((n) => (n.type === 'box' ? n : { ...n, measured: measured.get(n.id) }));
      }),
    [net, ix, selection, canManage, expanded, onToggleBox, onAddSplitter, selectNode, setNodes],
  );
  useEffect(() => setEdges(buildEdges(net, ix, selection, expanded, selectLink)), [net, ix, selection, expanded, selectLink, setEdges]);

  useImperativeHandle(apiRef, () => ({
    center: () => {
      const el = document.querySelector('.fiber-flow') as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      const p = rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 0) / 2, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 });
      return { x: p.x - NODE_W / 2, y: p.y - 60 };
    },
    fitView: () => void rf.fitView({ padding: 0.15, duration: 400 }),
    focus: (id) => {
      // Nested splitters are positioned relative to their box.
      const p = rf.getInternalNode(id)?.internals.positionAbsolute;
      if (p) void rf.setCenter(p.x + NODE_W / 2, p.y + 80, { zoom: Math.max(rf.getZoom(), 1), duration: 400 });
    },
  }));

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const from = ix.nodes.get(c.source);
      const to = ix.nodes.get(c.target);
      if (!from || !to || from.id === to.id) return false;
      // OLT uplink: a single core, from a TJ box.
      if (to.type === 'OLT' && (from.type !== 'TJ_BOX' || ix.into.get(to.id)?.length)) return false;
      const port = c.sourceHandle?.startsWith('p') ? Number(c.sourceHandle.slice(1)) : null;
      if (port != null && (ix.outByPort.has(`${from.id}:${port}`) || ix.custByPort.has(`${from.id}:${port}`))) return false;
      if (port == null) return false;
      // TJ boxes take one core per splice position; splitters a single input.
      if (to.type === 'TJ_BOX') {
        const slot = c.targetHandle?.startsWith('i') ? Number(c.targetHandle.slice(1)) : null;
        return slot != null && !ix.inBySlot.has(`${to.id}:${slot}`);
      }
      if (to.type === 'SPLITTER' && ix.into.get(to.id)?.length) return false;
      return true;
    },
    [ix],
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      const port = c.sourceHandle?.startsWith('p') ? Number(c.sourceHandle.slice(1)) : null;
      const slot = c.targetHandle?.startsWith('i') ? Number(c.targetHandle.slice(1)) : null;
      onConnect({ fromNodeId: c.source, fromPort: port, toNodeId: c.target, toPort: slot });
    },
    [onConnect],
  );

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DND_TYPE) as FiberNodeType;
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // A splitter dropped onto a TJ box is installed in that box.
    const box =
      type === 'SPLITTER'
        ? rf.getIntersectingNodes({ x: p.x, y: p.y, width: 1, height: 1 }).find((n) => n.type === 'box')
        : undefined;
    onCreateAt(type, { x: p.x - NODE_W / 2, y: p.y - HEADER_H / 2 }, box?.id);
  };

  return (
    <ReactFlow
      className="fiber-flow"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      colorMode={theme}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
      minZoom={0.15}
      maxZoom={2}
      deleteKeyCode={null}
      nodesConnectable={canManage}
      isValidConnection={isValidConnection}
      onConnect={handleConnect}
      connectionLineStyle={{ stroke: '#FCD535', strokeWidth: 2.5 }}
      // Fingers are imprecise: snap a dragged cable to a port from further away.
      connectionRadius={touch ? 36 : 20}
      onNodeClick={(_, n) =>
        n.type === 'customer' ? onSelect({ kind: 'customer', id: n.id.slice(5) }) : onSelect({ kind: 'node', id: n.id })
      }
      onEdgeClick={(_, e) => !e.id.startsWith('drop:') && onSelect({ kind: 'link', id: e.id })}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={(_, __, dragged) =>
        onMoved(dragged.filter((n) => n.type !== 'customer' && !n.parentId).map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })))
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--surface-3)" />
      <Controls showInteractive={false} position="bottom-left" />
{!compact && (
              <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(n) => (n.type === 'olt' ? '#FCD535' : n.type === 'customer' || n.parentId ? 'var(--muted)' : 'var(--surface-3)')}
        nodeStrokeWidth={0}
        maskColor="rgb(11 14 17 / 0.55)"
      />
      )}
    </ReactFlow>
  );
}

export function Schematic(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/** Left-to-right layered layout: OLTs in column 0, each hop one column right. Nested splitters ride inside their box. */
export function autoLayout(net: FiberNetwork, ix: NetIndex, expanded: ReadonlySet<string>, canManage: boolean): { id: string; x: number; y: number }[] {
  const COL_W = NODE_W + LEAF_GAP + 176 + 80;
  const GAP_Y = 36;
  const depth = new Map<string, number>();
  const order: string[] = [];
  // A splitter inside a box shares the box's column.
  const anchor = (id: string) => nestBox(ix, ix.nodes.get(id))?.id ?? id;
  const roots = net.nodes.filter((n) => !nestBox(ix, n) && !ix.into.get(n.id)?.length).sort((a, b) => (a.type === 'OLT' ? -1 : 0) - (b.type === 'OLT' ? -1 : 0));
  const visit = (id: string, d: number, trail: Set<string>) => {
    if (trail.has(id)) return;
    if ((depth.get(id) ?? -1) < d) depth.set(id, d);
    if (!order.includes(id)) order.push(id);
    const next = new Set(trail).add(id);
    // Outputs of this node and of the splitters inside it.
    const outs = [id, ...(ix.nodes.get(id)?.type === 'TJ_BOX' ? boxSplitters(ix, id).map((s) => s.id) : [])].flatMap((x) => ix.out.get(x) ?? []);
    for (const l of outs.sort((a, b) => (a.fromPort ?? 0) - (b.fromPort ?? 0))) {
      const t = anchor(l.toNodeId);
      if (t !== id) visit(t, d + 1, next);
    }
  };
  roots.forEach((r) => visit(r.id, 0, new Set()));
  net.nodes.forEach((n) => !nestBox(ix, n) && !depth.has(n.id) && visit(n.id, 0, new Set()));

  const cursor = new Map<number, number>();
  const y = new Map<string, number>();
  const res: { id: string; x: number; y: number }[] = [];
  for (const id of order) {
    const n = ix.nodes.get(id)!;
    const d = depth.get(id)!;
    const parentY = ix.into.get(id)?.map((l) => y.get(anchor(l.fromNodeId))).find((v) => v != null) ?? 0;
    const top = Math.max(cursor.get(d) ?? 0, parentY);
    y.set(id, top);
    cursor.set(d, top + displayHeight(n, ix, expanded, canManage) + GAP_Y);
    res.push({ id, x: d * COL_W, y: top });
  }
  return res;
}
