import { useEffect, useMemo, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  ArrowRight,
  Box,
  Cable,
  ClipboardPaste,
  Crosshair,
  ExternalLink,
  MapPin,
  Navigation,
  Plus,
  Route,
  Ruler,
  Search,
  Server,
  Split,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import {
  CABLE_CORE_COUNTS,
  FIBER_COLORS,
  cableKey,
  FIBER_NODE_LABELS,
  SPLITTER_RATIOS,
  fiberColorFor,
  fiberLinkUpdateSchema,
  markLength,
  fiberNodeUpdateSchema,
  type FiberLink,
  type FiberNetwork,
  type FiberNode,
  type FiberNodeType,
} from '@isp/shared';
import { errorMessage } from '@/lib/api';
import { parseLatLng } from '@/lib/coords';
import {
  useAssignPort,
  useCreateLink,
  useDeleteLink,
  useDeleteNode,
  useInsertBox,
  useUnassignPort,
  useUpdateLink,
  useUpdateNode,
} from '@/lib/queries';
import {
  cableCores,
  distanceM,
  fiberHex,
  fmtLength,
  fmtMarks,
  freeInSlots,
  freeOutPorts,
  nextFreeCore,
  nextName,
  nodePos,
  outputPorts,
  polylineM,
  portName,
  sourceLabel,
  type LatLng,
  type NetIndex,
} from '@/lib/fiber';
import { CustomerPickerModal } from '@/components/CustomerPickerModal';
import { Badge, Button, ConfirmDialog, Field, IconButton, Input, Modal, Select, StatusBadge, Textarea } from '@/components/ui';
import type { LinkDraft } from './Schematic';
import type { Selection } from './types';

export const NODE_ICON: Record<FiberNodeType, typeof Server> = { OLT: Server, TJ_BOX: Box, SPLITTER: Split };

// ---- Small building blocks --------------------------------------------------
export function ColorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  const hex = fiberHex(color);
  return (
    <span
      className={clsx('inline-block size-3 shrink-0 rounded-full ring-1 ring-hairline', className)}
      style={{ background: hex ?? 'transparent' }}
      aria-hidden
    />
  );
}

/** Fiber color select with a live color swatch (color always paired with its name). */
function ColorSelect({ value, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { value?: string | null }) {
  return (
    <div className="relative">
      <ColorDot color={value} className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2" />
      <Select {...rest} value={value ?? ''} className="pl-9">
        <option value="">—</option>
        {FIBER_COLORS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Section({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-hairline px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelHeader({ icon, title, sub, onClose, badge }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; onClose: () => void; badge?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5 pb-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="num truncate text-base font-semibold text-strong">{title}</h3>
          {badge}
        </div>
        {sub && <p className="mt-0.5 truncate text-[13px] text-muted">{sub}</p>}
      </div>
      <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

function RowButton({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

const num = (v: unknown) => (v === '' || v == null ? null : Number(v));

// ---- Node inspector ---------------------------------------------------------
type NodeValues = Record<
  'name' | 'latitude' | 'longitude' | 'address' | 'ipAddress' | 'model' | 'ponPorts' | 'ponPrefix' | 'cablePorts' | 'splitterRatio' | 'boxId' | 'notes',
  string
>;

const nodeValues = (n: FiberNode): NodeValues => ({
  name: n.name,
  latitude: n.latitude?.toString() ?? '',
  longitude: n.longitude?.toString() ?? '',
  address: n.address ?? '',
  ipAddress: n.ipAddress ?? '',
  model: n.model ?? '',
  ponPorts: n.ponPorts?.toString() ?? '',
  ponPrefix: n.ponPrefix ?? '',
  cablePorts: n.cablePorts?.toString() ?? '',
  splitterRatio: n.splitterRatio ?? '',
  boxId: n.boxId ?? '',
  notes: n.notes ?? '',
});

export function NodeInspector({
  node,
  net,
  ix,
  canManage,
  onSelect,
  onPickOnMap,
  onAddSplitter,
  onConnect,
}: {
  node: FiberNode;
  net: FiberNetwork;
  ix: NetIndex;
  canManage: boolean;
  onSelect: (s: Selection | null) => void;
  onPickOnMap: (n: FiberNode) => void;
  onAddSplitter?: (boxId: string) => void;
  /** Start a new cable from one of this node's free ports (touch-friendly alternative to dragging a handle). */
  onConnect?: (draft: LinkDraft) => void;
}) {
  const update = useUpdateNode();
  const [connecting, setConnecting] = useState(false);
  const freeOut = freeOutPorts(ix, node);
  const del = useDeleteNode();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<NodeValues>({ resolver: zodResolver(fiberNodeUpdateSchema) as never, defaultValues: nodeValues(node) });
  const { register, handleSubmit, reset, setValue, watch, formState } = form;
  useEffect(() => reset(nodeValues(node)), [node.id, node.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapsUrl = googleMapsUrl(watch('latitude'), watch('longitude'));

  const Icon = NODE_ICON[node.type];
  const ro = !canManage;

  const onSubmit = handleSubmit(async (v) => {
    try {
      // Splitters have no GPS of their own — they are drawn at their TJ box.
      const gps = node.type === 'SPLITTER' ? { latitude: null, longitude: null } : {};
      await update.mutateAsync({ id: node.id, ...(v as object), ...gps });
      toast.success(`${node.name} saved`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  const locate = () => {
    if (!navigator.geolocation) return toast.error('Geolocation is not supported by this browser');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setValue('latitude', p.coords.latitude.toFixed(6), { shouldDirty: true });
        setValue('longitude', p.coords.longitude.toFixed(6), { shouldDirty: true });
      },
      (err) => toast.error(`Could not get location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const applyCoords = (text: string) => {
    const ll = parseLatLng(text);
    if (!ll) return false;
    setValue('latitude', String(ll[0]), { shouldDirty: true, shouldValidate: true });
    setValue('longitude', String(ll[1]), { shouldDirty: true, shouldValidate: true });
    return true;
  };

  const pasteCoords = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return toast.error('Clipboard access blocked — paste into the Latitude field instead (Ctrl/⌘+V)');
    }
    if (!applyCoords(text)) toast.error('Clipboard has no coordinates — copy something like "23.9085, 90.2276"');
  };

  // Pasting a full "lat, lng" pair into either field fills both.
  const onCoordPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (ro) return;
    const text = e.clipboardData.getData('text');
    if (/[,\s]/.test(text.trim()) && applyCoords(text)) e.preventDefault();
  };

  const boxes = net.nodes.filter((n) => n.type === 'TJ_BOX');
  const into = ix.into.get(node.id) ?? [];
  const out = ix.out.get(node.id) ?? [];
  const box = node.boxId ? ix.nodes.get(node.boxId) : undefined;
  const boxPos = node.type === 'SPLITTER' ? nodePos(ix, node) : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <PanelHeader
        icon={<Icon className="size-[18px]" />}
        title={node.name}
        sub={FIBER_NODE_LABELS[node.type]}
        badge={node.type === 'SPLITTER' && node.splitterRatio ? <Badge>{node.splitterRatio}</Badge> : undefined}
        onClose={() => onSelect(null)}
      />

      <Section title="Details">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required className="col-span-2" error={formState.errors.name?.message}>
            <Input {...register('name')} readOnly={ro} className="num" />
          </Field>
          {node.type === 'OLT' && (
            <>
              <Field label="IP / host" className="col-span-2">
                <Input {...register('ipAddress')} readOnly={ro} numeric placeholder="10.10.0.2" />
              </Field>
              <Field label="Model" className="col-span-2">
                <Input {...register('model')} readOnly={ro} placeholder="e.g. VSOL V1600G" />
              </Field>
              <Field label="PON ports" error={formState.errors.ponPorts?.message}>
                <Input {...register('ponPorts')} readOnly={ro} numeric inputMode="numeric" />
              </Field>
              <Field label="Port prefix" hint="0/1/ → 0/1/4">
                <Input {...register('ponPrefix')} readOnly={ro} numeric placeholder="0/1/" />
              </Field>
            </>
          )}
          {node.type === 'TJ_BOX' && (
            <Field label="Splice positions" className="col-span-2" hint="Core spliced in on position N leaves on Out N" error={formState.errors.cablePorts?.message}>
              <Input {...register('cablePorts')} readOnly={ro} numeric inputMode="numeric" placeholder="4" />
            </Field>
          )}
          {node.type === 'SPLITTER' && (
            <>
              <Field label="Ratio">
                <Select {...register('splitterRatio')} disabled={ro}>
                  {SPLITTER_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Installed in TJ box">
                <Select {...register('boxId')} disabled={ro}>
                  <option value="">— none —</option>
                  {boxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="Address / landmark" className="col-span-2">
            <Input {...register('address')} readOnly={ro} placeholder="Road 5, pole #12" />
          </Field>
        </div>
      </Section>

      {node.type === 'SPLITTER' ? (
        <Section title="Location">
          {boxPos && box ? (
            <p className="text-sm text-muted">
              Shown on the map at its TJ box{' '}
              <button type="button" className="num font-medium text-accent hover:underline" onClick={() => onSelect({ kind: 'node', id: box.id })}>
                {box.name}
              </button>{' '}
              <span className="num">({boxPos[0].toFixed(5)}, {boxPos[1].toFixed(5)})</span>.
            </p>
          ) : box ? (
            <p className="text-sm text-muted">
              TJ box{' '}
              <button type="button" className="num font-medium text-accent hover:underline" onClick={() => onSelect({ kind: 'node', id: box.id })}>
                {box.name}
              </button>{' '}
              has no GPS yet — set it on the box to show this splitter on the map.
            </p>
          ) : (
            <p className="text-sm text-muted">Choose the TJ box it is installed in — the splitter is shown on the map at the box’s GPS.</p>
          )}
        </Section>
      ) : (
      <Section title="GPS location">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={formState.errors.latitude?.message}>
            <Input {...register('latitude')} readOnly={ro} numeric inputMode="decimal" onPaste={onCoordPaste} />
          </Field>
          <Field label="Longitude" error={formState.errors.longitude?.message}>
            <Input {...register('longitude')} readOnly={ro} numeric inputMode="decimal" onPaste={onCoordPaste} />
          </Field>
        </div>
        {(canManage || mapsUrl) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button size="sm" variant="secondary" onClick={() => onPickOnMap(node)}>
                  <MapPin className="size-4" /> Pick on map
                </Button>
                <Button size="sm" variant="ghost" onClick={locate}>
                  <Crosshair className="size-4" /> My location
                </Button>
                <Button size="sm" variant="ghost" onClick={pasteCoords} title="Paste “lat, lng” from the clipboard">
                  <ClipboardPaste className="size-4" /> Paste
                </Button>
              </>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                title="Open this location in Google Maps (opens the app on phones)"
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold leading-none whitespace-nowrap text-muted-strong transition-colors hover:bg-surface-2 hover:text-strong"
              >
                <Navigation className="size-4" /> Google Maps
              </a>
            )}
          </div>
        )}
      </Section>
      )}

      {node.type === 'SPLITTER' && (
        <SplitterPorts node={node} ix={ix} canManage={canManage} onSelect={onSelect} />
      )}

      {node.type === 'TJ_BOX' && <BoxPositions node={node} ix={ix} onSelect={onSelect} />}

      {node.type === 'OLT' && (
        <Section title="Uplink">
          {into[0] ? (
            (() => {
              const l = into[0];
              const from = ix.nodes.get(l.fromNodeId);
              return (
                <RowButton onClick={() => onSelect({ kind: 'link', id: l.id })}>
                  <ColorDot color={l.coreColor} />
                  <span className="text-xs text-muted">from</span>
                  <span className="num truncate text-strong">
                    {from?.name}
                    {from && l.fromPort != null ? ` · ${portName(from, l.fromPort)}` : ''}
                  </span>
                  <span className="num ml-auto shrink-0 text-xs text-muted">
                    {[l.cableCode, l.coreNumber != null ? `#${l.coreNumber}` : null].filter(Boolean).join(' ')} {fmtLength(l.length)}
                  </span>
                </RowButton>
              );
            })()
          ) : (
            <p className="text-[13px] text-muted">
              No uplink yet. On the schematic, drag from a free out port of the TJ box that brings the backbone fiber onto this OLT — or select that box and use “Run a cable”.
            </p>
          )}
        </Section>
      )}

      {node.type === 'OLT' && (
        <Section title={`PON ports · ${outputPorts(node)}`}>
          <ul className="space-y-0.5">
            {Array.from({ length: outputPorts(node) }, (_, i) => {
              const l = ix.outByPort.get(`${node.id}:${i + 1}`);
              const to = l ? ix.nodes.get(l.toNodeId) : undefined;
              return (
                <li key={i}>
                  <RowButton onClick={l ? () => onSelect({ kind: 'link', id: l.id }) : undefined}>
                    <span className={clsx('size-1.5 rounded-full', l ? 'bg-up' : 'bg-surface-3')} />
                    <span className="num w-24 text-muted-strong">{portName(node, i + 1)}</span>
                    {to ? (
                      <span className="num flex min-w-0 flex-1 items-center gap-1.5 truncate text-strong">
                        <ArrowRight className="size-3.5 text-muted" /> {to.name}
                        {l!.toPort != null && <span className="text-muted">· In {l!.toPort}</span>}
                        <span className="ml-auto text-xs text-muted">
                          {[l!.cableCode, l!.coreNumber != null ? `#${l!.coreNumber}` : null].filter(Boolean).join(' ') || fmtLength(l!.length)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">free — drag from this port on the canvas</span>
                    )}
                  </RowButton>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {node.type === 'TJ_BOX' && (
        <Section
          title="Splitters inside"
          action={
            canManage && onAddSplitter ? (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onAddSplitter(node.id)}>
                <Plus className="size-3.5" /> Add splitter
              </Button>
            ) : undefined
          }
        >
          {(ix.splittersInBox.get(node.id) ?? []).length ? (
            <ul className="space-y-0.5">
              {ix.splittersInBox.get(node.id)!.map((s) => {
                const total = outputPorts(s);
                const used = Array.from({ length: total }, (_, i) => i + 1).filter(
                  (p) => ix.custByPort.has(`${s.id}:${p}`) || ix.outByPort.has(`${s.id}:${p}`),
                ).length;
                const feed = ix.into.get(s.id)?.[0];
                return (
                  <li key={s.id}>
                    <RowButton onClick={() => onSelect({ kind: 'node', id: s.id })}>
                      <Split className="size-4 text-accent" />
                      <span className="num text-strong">{s.name}</span>
                      <span className="num truncate text-xs text-muted">
                        {feed ? (feed.fromNodeId === node.id ? `← Out ${feed.fromPort ?? ''}` : `← ${ix.nodes.get(feed.fromNodeId)?.name ?? ''}`) : 'not fed'}
                      </span>
                      <span className="num ml-auto shrink-0 text-xs text-muted">{used}/{total}</span>
                      <Badge>{s.splitterRatio}</Badge>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">None yet. Add one here, drop a splitter onto this box on the canvas, or pick this box under a splitter’s “Installed in TJ box”.</p>
          )}
        </Section>
      )}

      {node.type === 'SPLITTER' && (
        <Section title="Cables">
          {into.length + out.length === 0 ? (
            <p className="text-[13px] text-muted">
              Not connected. On the schematic, drag from a free port (●) of an OLT, box or splitter onto this node.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {[...into.map((l) => ({ l, dir: 'in' as const })), ...out.map((l) => ({ l, dir: 'out' as const }))].map(({ l, dir }) => {
                const other = ix.nodes.get(dir === 'in' ? l.fromNodeId : l.toNodeId);
                return (
                  <li key={l.id}>
                    <RowButton onClick={() => onSelect({ kind: 'link', id: l.id })}>
                      <ColorDot color={l.coreColor} />
                      <span className="text-xs text-muted">{dir === 'in' ? 'from' : 'to'}</span>
                      <span className="num truncate text-strong">
                        {other?.name}
                        {dir === 'in' && other && l.fromPort != null ? ` · ${portName(other, l.fromPort)}` : ''}
                      </span>
                      <span className="num ml-auto shrink-0 text-xs text-muted">
                        {l.cableCode ?? ''} {fmtLength(l.length)}
                      </span>
                    </RowButton>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      {canManage && onConnect && freeOut.length > 0 && (
        <Section title="Connect">
          <Button size="sm" variant="secondary" onClick={() => setConnecting(true)}>
            <Cable className="size-4" /> Run a cable from {node.name}
          </Button>
          <p className="mt-2 text-xs text-muted">
            <span className="num">{freeOut.length}</span> free {node.type === 'OLT' ? 'PON port' : node.type === 'TJ_BOX' ? 'out port' : 'output'}
            {freeOut.length === 1 ? '' : 's'}. Works on touch screens — no dragging needed.
          </p>
        </Section>
      )}

      <Section title="Notes">
        <Textarea {...register('notes')} readOnly={ro} rows={3} placeholder="Pole number, access info, splice tray…" />
      </Section>

      {canManage && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-hairline bg-surface px-5 py-3">
          <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty} className="flex-1">
            Save changes
          </Button>
          <IconButton label={`Delete ${node.name}`} onClick={() => setConfirm(true)} className="hover:text-down">
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      )}

      {onConnect && <ConnectCableModal open={connecting} node={node} net={net} ix={ix} onClose={() => setConnecting(false)} onPick={(d) => {
        setConnecting(false);
        onConnect(d);
      }} />}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        loading={del.isPending}
        title={`Delete ${node.name}?`}
        confirmLabel="Delete"
        message="All cables connected to it are removed too, and customers patched into it are disconnected (their saved fiber details stay on their profile)."
        onConfirm={async () => {
          try {
            await del.mutateAsync(node.id);
            toast.success(`${node.name} deleted`);
            setConfirm(false);
            onSelect(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </form>
  );
}

/** Pick a free port and a destination device, then hand off to NewLinkModal. */
function ConnectCableModal({
  open,
  node,
  net,
  ix,
  onClose,
  onPick,
}: {
  open: boolean;
  node: FiberNode;
  net: FiberNetwork;
  ix: NetIndex;
  onClose: () => void;
  onPick: (d: LinkDraft) => void;
}) {
  const ports = freeOutPorts(ix, node);
  const [port, setPort] = useState<number | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) {
      setPort(ports[0] ?? null);
      setQ('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same rules as the canvas: one uplink per OLT (from a TJ box), one input per splitter, one core per TJ splice position.
  const targets = net.nodes
    .filter((t) => {
      if (t.id === node.id) return false;
      if (t.type === 'OLT') return node.type === 'TJ_BOX' && !ix.into.get(t.id)?.length;
      if (t.type === 'SPLITTER') return !ix.into.get(t.id)?.length;
      return freeInSlots(ix, t).length > 0;
    })
    .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return (
    <Modal open={open} onClose={onClose} title={`Run a cable from ${node.name}`} subtitle="Choose the port, then the device the core goes to.">
      <div className="space-y-4">
        <Field label={node.type === 'OLT' ? 'From PON port' : node.type === 'TJ_BOX' ? 'From out port' : 'From output'}>
          <Select value={port ?? ''} onChange={(e) => setPort(e.target.value ? Number(e.target.value) : null)}>
            {ports.map((p) => (
              <option key={p} value={p}>
                {portName(node, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To device">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={node.type === 'TJ_BOX' ? 'Search TJ boxes, splitters and OLTs' : 'Search TJ boxes and splitters'} leading={<Search className="size-4" />} />
        </Field>
        <ul className="-mx-2 max-h-[40vh] divide-y divide-hairline overflow-y-auto">
          {targets.map((t) => {
            const TIcon = NODE_ICON[t.type];
            const box = t.boxId ? ix.nodes.get(t.boxId) : undefined;
            const slots = t.type === 'TJ_BOX' ? freeInSlots(ix, t).length : null;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={port == null}
                  onClick={() => port != null && onPick({ fromNodeId: node.id, fromPort: port, toNodeId: t.id, toPort: null })}
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <TIcon className="size-4 shrink-0 text-accent" />
                  <span className="num min-w-0 flex-1 truncate text-sm font-medium text-strong">{t.name}</span>
                  <span className="num shrink-0 text-xs text-muted">
                    {t.type === 'SPLITTER'
                      ? `${t.splitterRatio ?? ''}${box ? ` · in ${box.name}` : ''}`
                      : t.type === 'OLT'
                        ? 'uplink'
                        : `${slots} free position${slots === 1 ? '' : 's'}`}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            );
          })}
          {!targets.length && <li className="px-2 py-6 text-center text-sm text-muted">No device can take another cable. Add a TJ box or splitter first.</li>}
        </ul>
      </div>
    </Modal>
  );
}

/** TJ box splice positions: core in on N (left) continues out on N (right). */
function BoxPositions({ node, ix, onSelect }: { node: FiberNode; ix: NetIndex; onSelect: (s: Selection | null) => void }) {
  const count = outputPorts(node);
  const used = Array.from({ length: count }, (_, i) => i + 1).filter((p) => ix.inBySlot.has(`${node.id}:${p}`)).length;
  const cell = 'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 disabled:hover:bg-transparent';
  return (
    <Section title={<>Splice positions · <span className="num">{used}/{count}</span> in use</>}>
      <div className="mb-1 flex px-2 text-[11px] text-muted">
        <span className="w-6">#</span>
        <span className="flex-1">Core in</span>
        <span className="flex-1 pl-2">Out</span>
      </div>
      <ul className="space-y-0.5">
        {Array.from({ length: count }, (_, i) => {
          const pos = i + 1;
          const inL = ix.inBySlot.get(`${node.id}:${pos}`);
          const outL = ix.outByPort.get(`${node.id}:${pos}`);
          const src = inL ? ix.nodes.get(inL.fromNodeId) : undefined;
          const dst = outL ? ix.nodes.get(outL.toNodeId) : undefined;
          return (
            <li key={pos} className="flex items-center text-[13px]">
              <span className="num w-6 shrink-0 pl-2 text-muted-strong">{pos}</span>
              <button type="button" disabled={!inL} onClick={() => inL && onSelect({ kind: 'link', id: inL.id })} className={cell}>
                {inL && src ? (
                  <>
                    <ColorDot color={inL.coreColor} />
                    <span className="num truncate text-strong" title={sourceLabel(ix, inL)}>
                      {src.name}
                      {inL.fromPort != null && <span className="text-muted"> · {portName(src, inL.fromPort)}</span>}
                    </span>
                    <span className="num ml-auto shrink-0 text-xs text-muted">
                      {[inL.cableCode, inL.coreNumber != null ? `#${inL.coreNumber}` : null].filter(Boolean).join(' ')}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </button>
              <button type="button" disabled={!outL} onClick={() => outL && onSelect({ kind: 'link', id: outL.id })} className={cell}>
                {outL && dst ? (
                  <>
                    <ArrowRight className="size-3.5 shrink-0 text-muted" />
                    <span className="num truncate text-strong">{dst.name}</span>
                    <span className="num ml-auto shrink-0 text-xs text-muted">
                      {[outL.cableCode, outL.coreNumber != null ? `#${outL.coreNumber}` : null].filter(Boolean).join(' ')}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">free</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">Drag a core onto a position’s left dot on the canvas; drag from its right dot to send it onward.</p>
    </Section>
  );
}

function SplitterPorts({ node, ix, canManage, onSelect }: { node: FiberNode; ix: NetIndex; canManage: boolean; onSelect: (s: Selection | null) => void }) {
  const assign = useAssignPort();
  const unassign = useUnassignPort();
  const [pickPort, setPickPort] = useState<number | null>(null);
  const count = outputPorts(node);
  const feed = ix.into.get(node.id)?.[0];
  const feedFrom = feed ? ix.nodes.get(feed.fromNodeId) : undefined;
  const used = Array.from({ length: count }, (_, i) => i + 1).filter(
    (p) => ix.custByPort.has(`${node.id}:${p}`) || ix.outByPort.has(`${node.id}:${p}`),
  ).length;

  return (
    <>
      <Section title="Input">
        {feed && feedFrom ? (
          <RowButton onClick={() => onSelect({ kind: 'link', id: feed.id })}>
            <ColorDot color={feed.coreColor} />
            <span className="num text-strong">
              {feedFrom.name}
              {feed.fromPort != null ? ` · ${portName(feedFrom, feed.fromPort)}` : ''}
            </span>
            <span className="num ml-auto text-xs text-muted">
              {feed.cableCode ?? ''} {feed.coreNumber != null ? `#${feed.coreNumber}` : ''}
            </span>
          </RowButton>
        ) : (
          <p className="text-[13px] text-muted">Not fed yet — drag a cable from an OLT PON port, TJ box or another splitter onto this splitter.</p>
        )}
      </Section>
      <Section title={<>Output ports · <span className="num">{used}/{count}</span> used</>}>
        <ul className="divide-y divide-hairline">
          {Array.from({ length: count }, (_, i) => {
            const port = i + 1;
            const color = fiberColorFor(port);
            const cust = ix.custByPort.get(`${node.id}:${port}`);
            const link = ix.outByPort.get(`${node.id}:${port}`);
            const to = link ? ix.nodes.get(link.toNodeId) : undefined;
            return (
              <li key={port} className="flex h-10 items-center gap-2 text-[13px]">
                <span className="num w-7 text-muted-strong">P{port}</span>
                <span className="flex w-20 items-center gap-1.5 text-xs text-muted">
                  <ColorDot color={color} /> {color}
                </span>
                {cust ? (
                  <>
                    <button type="button" onClick={() => onSelect({ kind: 'customer', id: cust.id })} className="min-w-0 flex-1 truncate text-left text-strong hover:text-accent">
                      {cust.name}
                    </button>
                    {canManage && (
                      <IconButton
                        label={`Disconnect ${cust.name}`}
                        className="size-7 hover:text-down"
                        onClick={async () => {
                          try {
                            await unassign.mutateAsync(cust.id);
                            toast.success(`${cust.name} disconnected from P${port}`);
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      >
                        <Unplug className="size-3.5" />
                      </IconButton>
                    )}
                  </>
                ) : to ? (
                  <button type="button" onClick={() => onSelect({ kind: 'link', id: link!.id })} className="num min-w-0 flex-1 truncate text-left text-strong hover:text-accent">
                    → {to.name}
                  </button>
                ) : (
                  <>
                    <span className="flex-1 text-muted">free</span>
                    {canManage && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPickPort(port)}>
                        <Plus className="size-3.5" /> Customer
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <CustomerPickerModal
        open={pickPort != null}
        onClose={() => setPickPort(null)}
        title={`Connect customer to ${node.name} · P${pickPort ?? ''}`}
        subtitle={`Port color ${pickPort ? fiberColorFor(pickPort) : ''}. OLT, PON, splitter, box and core color on the customer profile are filled in automatically.`}
        onPick={async (c) => {
          const port = pickPort!;
          setPickPort(null);
          try {
            await assign.mutateAsync({ customerId: c.id, nodeId: node.id, port });
            toast.success(`${c.name} connected to ${node.name} P${port}`);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

// ---- Link (cable) inspector -------------------------------------------------
type LinkValues = Record<'cableCode' | 'coreCount' | 'tubeColor' | 'coreNumber' | 'coreColor' | 'length' | 'startMark' | 'endMark' | 'notes', string>;

const linkValues = (l: Partial<FiberLink>): LinkValues => ({
  cableCode: l.cableCode ?? '',
  coreCount: l.coreCount?.toString() ?? '',
  tubeColor: l.tubeColor ?? '',
  coreNumber: l.coreNumber?.toString() ?? '',
  coreColor: l.coreColor ?? '',
  length: l.length?.toString() ?? '',
  startMark: l.startMark?.toString() ?? '',
  endMark: l.endMark?.toString() ?? '',
  notes: l.notes ?? '',
});

function LinkFields({
  form,
  ro,
  gpsLength,
  usedCores,
  sharedWith = 0,
}: {
  form: UseFormReturn<LinkValues>;
  ro: boolean;
  gpsLength: number | null;
  /** Core numbers taken by other cores of the same cable. */
  usedCores?: number[];
  /** Number of other cores in this cable (shared fields are synced to them). */
  sharedWith?: number;
}) {
  const { register, watch, setValue, formState } = form;
  const coreReg = register('coreNumber');
  const coreColor = watch('coreColor');
  const tubeColor = watch('tubeColor');
  const startReg = register('startMark');
  const endReg = register('endMark');
  // Both sheath marks known → the run length is the difference between them.
  const syncLength = () => {
    const len = markLength(num(form.getValues('startMark')), num(form.getValues('endMark')));
    if (len != null && Number.isFinite(len)) setValue('length', String(len), { shouldDirty: true });
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Cable ID / route">
        <Input {...register('cableCode')} readOnly={ro} numeric placeholder="CBL-534" />
      </Field>
      <Field label="Cable cores">
        <Select {...register('coreCount')} disabled={ro}>
          <option value="">—</option>
          {CABLE_CORE_COUNTS.map((c) => (
            <option key={c} value={c}>
              {c} core
            </option>
          ))}
        </Select>
      </Field>
      {sharedWith > 0 && (
        <p className="col-span-2 -mt-1 text-xs text-muted">
          Cable cores, length, meter marks and route are shared with the other <span className="num">{sharedWith}</span> core
          {sharedWith > 1 ? 's' : ''} of this cable.
        </p>
      )}
      <Field
        label="Core #"
        error={formState.errors.coreNumber?.message}
        hint={usedCores?.length ? <>Used: <span className="num">{usedCores.map((c) => `#${c}`).join(', ')}</span></> : undefined}
      >
        <Input
          {...coreReg}
          readOnly={ro}
          numeric
          inputMode="numeric"
          onChange={(e) => {
            void coreReg.onChange(e);
            // Standard TIA-598 core color for the number (repeats every 12).
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) setValue('coreColor', fiberColorFor(n), { shouldDirty: true });
          }}
        />
      </Field>
      <Field label="Core color">
        <ColorSelect {...register('coreColor')} value={coreColor} disabled={ro} />
      </Field>
      <Field label="Tube color" className="col-span-2">
        <ColorSelect {...register('tubeColor')} value={tubeColor} disabled={ro} />
      </Field>
      <Field label="Start meter mark" hint="Printed on the sheath at this end" error={formState.errors.startMark?.message}>
        <Input
          {...startReg}
          readOnly={ro}
          numeric
          inputMode="numeric"
          trailing="m"
          onChange={(e) => {
            void startReg.onChange(e);
            syncLength();
          }}
        />
      </Field>
      <Field label="End meter mark" hint="…and at the far end" error={formState.errors.endMark?.message}>
        <Input
          {...endReg}
          readOnly={ro}
          numeric
          inputMode="numeric"
          trailing="m"
          onChange={(e) => {
            void endReg.onChange(e);
            syncLength();
          }}
        />
      </Field>
      <Field
        label="Cable length"
        className="col-span-2"
        error={formState.errors.length?.message}
        hint={gpsLength != null ? <>GPS route ≈ <span className="num">{fmtLength(gpsLength)}</span> (add slack for loops / drops)</> : 'Set GPS on both ends to estimate'}
      >
        <div className="flex gap-2">
          <div className="flex-1">
            <Input {...register('length')} readOnly={ro} numeric inputMode="numeric" trailing="m" />
          </div>
          {!ro && gpsLength != null && (
            <Button size="md" variant="secondary" onClick={() => setValue('length', String(Math.round(gpsLength)), { shouldDirty: true })}>
              <Ruler className="size-4" /> Use GPS
            </Button>
          )}
        </div>
      </Field>
      <Field label="Notes" className="col-span-2">
        <Textarea {...register('notes')} readOnly={ro} rows={2} placeholder="Splice closure, pole numbers…" />
      </Field>
    </div>
  );
}

function routeLength(ix: NetIndex, fromId: string, toId: string, path: [number, number][] | null | undefined) {
  const a = nodePos(ix, ix.nodes.get(fromId));
  const b = nodePos(ix, ix.nodes.get(toId));
  return a && b ? polylineM([a, ...(path ?? []), b]) : null;
}

export function LinkInspector({
  link,
  ix,
  canManage,
  onSelect,
  onEditRoute,
  onAddCore,
}: {
  link: FiberLink;
  ix: NetIndex;
  canManage: boolean;
  onSelect: (s: Selection | null) => void;
  onEditRoute: (l: FiberLink) => void;
  /** Open the new-core dialog for another core of this cable. */
  onAddCore: (draft: LinkDraft) => void;
}) {
  const update = useUpdateLink();
  const del = useDeleteLink();
  const [confirm, setConfirm] = useState(false);
  const [inserting, setInserting] = useState(false);
  const form = useForm<LinkValues>({ resolver: zodResolver(fiberLinkUpdateSchema) as never, defaultValues: linkValues(link) });
  useEffect(() => form.reset(linkValues(link)), [link.id, link.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = ix.nodes.get(link.fromNodeId);
  const to = ix.nodes.get(link.toNodeId);
  const gps = routeLength(ix, link.fromNodeId, link.toNodeId, link.path);
  const cores = cableCores(ix, link);
  const others = cores.filter((c) => c.id !== link.id);
  const freeFrom = from ? freeOutPorts(ix, from) : [];
  const freeTo = to?.type === 'TJ_BOX' ? freeInSlots(ix, to) : [];
  const cableFull = link.coreCount != null && cores.length >= link.coreCount;
  const addBlocked = !link.cableCode
    ? 'Give the cable an ID first'
    : to?.type === 'SPLITTER'
      ? 'A splitter takes a single input core'
      : to?.type === 'OLT'
        ? 'An OLT takes a single uplink core'
      : cableFull
        ? `All ${link.coreCount} cores are in use`
        : !freeFrom.length
          ? `${from?.name} has no free port`
          : to?.type === 'TJ_BOX' && !freeTo.length
            ? `${to.name} has no free splice position`
            : null;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ id: link.id, ...(v as object) });
      toast.success(others.length ? `Cable saved · ${others.length + 1} cores in sync` : 'Cable saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <PanelHeader
        icon={<Cable className="size-[18px]" />}
        title={link.cableCode || 'Fiber cable'}
        sub={link.coreNumber != null ? `Core #${link.coreNumber}${link.coreColor ? ` · ${link.coreColor}` : ''}` : 'Cable core link'}
        badge={cores.length > 1 ? <Badge>{cores.length}{link.coreCount ? `/${link.coreCount}` : ''} cores</Badge> : undefined}
        onClose={() => onSelect(null)}
      />
      <Section title="Path">
        <div className="flex items-stretch gap-2 text-[13px]">
          {[
            { n: from, port: link.fromPort, label: from && link.fromPort != null ? portName(from, link.fromPort) : null },
            { n: to, port: link.toPort, label: link.toPort != null ? `In ${link.toPort} → Out ${link.toPort}` : null },
          ].map(({ n, label }, i) => (
            <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
              {i === 1 && <ArrowRight className="size-4 shrink-0 text-muted" />}
              <button
                type="button"
                onClick={() => n && onSelect({ kind: 'node', id: n.id })}
                className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-left hover:bg-surface-3"
              >
                <p className="text-[11px] text-muted uppercase">{n ? FIBER_NODE_LABELS[n.type] : '—'}</p>
                <p className="num truncate text-strong">{n?.name}</p>
                {label && <p className="num text-xs text-muted-strong">{label}</p>}
              </button>
            </div>
          ))}
        </div>
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => onEditRoute(link)} disabled={gps == null} title={gps == null ? 'Both ends need GPS' : undefined}>
              <Route className="size-4" /> {link.path?.length ? 'Edit route on map' : 'Draw route on map'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setInserting(true)} title="Cut this cable and splice a TJ box into it">
              <Box className="size-4" /> Insert TJ box
            </Button>
            {link.path?.length ? <span className="num text-xs text-muted">{link.path.length} bend points</span> : null}
          </div>
        )}
      </Section>
      <Section
        title={<>Cores in this cable · <span className="num">{cores.length}{link.coreCount ? `/${link.coreCount}` : ''}</span></>}
        action={
          canManage && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!!addBlocked}
              title={addBlocked ?? 'Use another core of this cable for a different port'}
              onClick={() =>
                onAddCore({
                  fromNodeId: link.fromNodeId,
                  fromPort: freeFrom[0] ?? null,
                  toNodeId: link.toNodeId,
                  toPort: freeTo[0] ?? null,
                  cableCode: link.cableCode,
                })
              }
            >
              <Plus className="size-4" /> Add core
            </Button>
          )
        }
      >
        <ul className="space-y-0.5">
          {cores.map((c) => (
            <li key={c.id}>
              <RowButton onClick={() => c.id !== link.id && onSelect({ kind: 'link', id: c.id })}>
                <ColorDot color={c.coreColor} />
                <span className={clsx('num w-8', c.id === link.id ? 'font-semibold text-accent' : 'text-muted-strong')}>
                  {c.coreNumber != null ? `#${c.coreNumber}` : '—'}
                </span>
                <span className="num min-w-0 flex-1 truncate text-strong">{from && c.fromPort != null ? portName(from, c.fromPort) : '—'}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted" />
                <span className="num shrink-0 text-xs text-muted">{c.toPort != null ? `In ${c.toPort}` : to?.name}</span>
              </RowButton>
            </li>
          ))}
        </ul>
        {!link.cableCode && canManage && (
          <p className="mt-2 text-xs text-muted">Set a cable ID below to run more cores (other ports) through the same physical cable.</p>
        )}
      </Section>
      <Section title="Cable & core">
        <LinkFields
          form={form}
          ro={!canManage}
          gpsLength={gps}
          sharedWith={others.length}
          usedCores={others.map((c) => c.coreNumber).filter((n): n is number => n != null)}
        />
      </Section>
      {canManage && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-hairline bg-surface px-5 py-3">
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty} className="flex-1">
            Save changes
          </Button>
          <IconButton label="Delete cable" onClick={() => setConfirm(true)} className="hover:text-down">
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      )}
      {canManage && (
        <InsertBoxModal
          link={link}
          ix={ix}
          open={inserting}
          onClose={() => setInserting(false)}
          onDone={(box) => {
            setInserting(false);
            onSelect({ kind: 'node', id: box.id });
          }}
        />
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        loading={del.isPending}
        title={cores.length > 1 ? 'Delete this core?' : 'Delete this cable?'}
        confirmLabel="Delete"
        message={`${from?.name ?? ''} → ${to?.name ?? ''} will be disconnected${cores.length > 1 ? ` on core #${link.coreNumber ?? '?'} only — the cable's other ${cores.length - 1} core${cores.length > 2 ? 's stay' : ' stays'}` : ''}.`}
        onConfirm={async () => {
          try {
            await del.mutateAsync(link.id);
            toast.success('Cable deleted');
            setConfirm(false);
            onSelect(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </form>
  );
}

// ---- Insert a TJ box into a cable -------------------------------------------
/** Point `frac` (0..1) of the way along a polyline. */
function pointAlong(pts: LatLng[], frac: number): LatLng | null {
  if (pts.length < 2) return null;
  let left = polylineM(pts) * frac;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = distanceM(a, b);
    if (left <= d) {
      const t = d ? left / d : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= d;
  }
  return pts[pts.length - 1]!;
}

const round6 = (v: number) => String(Math.round(v * 1e6) / 1e6);

/**
 * Cut a cable and splice a TJ box (new or existing) into it: A → B becomes A → box In N and
 * box Out N → B for every core, keeping cable ID, core numbers and colors.
 */
export function InsertBoxModal({
  link,
  ix,
  open,
  onClose,
  onDone,
}: {
  link: FiberLink;
  ix: NetIndex;
  open: boolean;
  onClose: () => void;
  onDone: (box: FiberNode) => void;
}) {
  const insert = useInsertBox();
  const from = ix.nodes.get(link.fromNodeId);
  const to = ix.nodes.get(link.toNodeId);
  const cores = cableCores(ix, link);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [whole, setWhole] = useState(true);
  const [name, setName] = useState('');
  const [ports, setPorts] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [boxId, setBoxId] = useState('');
  const [mark, setMark] = useState('');
  const [toBox, setToBox] = useState('');
  const n = whole ? cores.length : 1;

  const a = nodePos(ix, from);
  const b = nodePos(ix, to);
  const route = a && b ? [a, ...(link.path ?? []), b] : null;
  const boxPos: LatLng | null =
    mode === 'existing'
      ? nodePos(ix, ix.nodes.get(boxId))
      : lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? [Number(lat), Number(lng)]
        : null;
  const gpsToBox = a && boxPos ? distanceM(a, boxPos) : null;

  // Existing TJ boxes that can take this cable: not one of its ends, with enough free positions (In N + Out N both free).
  const boxes = useMemo(
    () =>
      [...ix.nodes.values()]
        .filter((x) => x.type === 'TJ_BOX' && x.id !== link.fromNodeId && x.id !== link.toNodeId)
        .map((x) => ({
          node: x,
          free: freeInSlots(ix, x).filter((p) => !ix.outByPort.has(`${x.id}:${p}`)).length,
        }))
        .sort((p, q) => p.node.name.localeCompare(q.node.name)),
    [ix, link],
  );

  useEffect(() => {
    if (!open) return;
    setMode('new');
    setWhole(true);
    setName(nextName([...ix.nodes.values()], 'TJ_BOX'));
    setPorts(String(Math.max(4, cores.length)));
    setLat('');
    setLng('');
    setAddress('');
    setBoxId(boxes.find((x) => x.free >= cores.length)?.node.id ?? '');
    setMark('');
    setToBox('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeMidway = () => {
    const p = route && pointAlong(route, 0.5);
    if (!p) return;
    setLat(round6(p[0]));
    setLng(round6(p[1]));
  };
  const pasteCoords = async () => {
    try {
      const ll = parseLatLng(await navigator.clipboard.readText());
      if (!ll) return toast.error('Clipboard has no coordinates — copy something like "23.9085, 90.2276"');
      setLat(String(ll[0]));
      setLng(String(ll[1]));
    } catch {
      toast.error('Clipboard access blocked — paste into the Latitude field instead (Ctrl/⌘+V)');
    }
  };
  const onCoordPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const ll = parseLatLng(e.clipboardData.getData('text'));
    if (!ll) return;
    e.preventDefault();
    setLat(String(ll[0]));
    setLng(String(ll[1]));
  };

  // Schematic spot for a new box: halfway between the two ends (splitters sit inside their box).
  const canvasOf = (x: FiberNode | undefined) => (x?.type === 'SPLITTER' && x.boxId ? ix.nodes.get(x.boxId) : x);
  const ca = canvasOf(from);
  const cb = canvasOf(to);

  const chosenBox = boxes.find((x) => x.node.id === boxId);
  const blocked =
    mode === 'new'
      ? !name.trim()
        ? 'Name the new box'
        : null
      : !chosenBox
        ? 'Choose a TJ box'
        : chosenBox.free < n
          ? `${chosenBox.node.name} has only ${chosenBox.free} free splice position${chosenBox.free === 1 ? '' : 's'}`
          : null;

  const submit = async () => {
    try {
      const res = await insert.mutateAsync({
        linkId: link.id,
        wholeCable: whole,
        mark: mark || null,
        lengthToBox: toBox || null,
        ...(mode === 'existing'
          ? { boxId }
          : {
              newBox: {
                name: name.trim(),
                cablePorts: ports || null,
                latitude: lat || null,
                longitude: lng || null,
                address: address || null,
                posX: ca && cb ? Math.round((ca.posX + cb.posX) / 2) : undefined,
                posY: ca && cb ? Math.round((ca.posY + cb.posY) / 2) : undefined,
              },
            }),
      });
      toast.success(`${res.box.name} inserted · ${res.links.length} core${res.links.length === 1 ? '' : 's'} spliced through`);
      onDone(res.box);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const boxLabel = mode === 'new' ? name.trim() || 'New box' : (chosenBox?.node.name ?? 'TJ box');
  const marksHint =
    link.startMark != null && link.endMark != null ? (
      <>
        Between <span className="num">{link.startMark}</span> and <span className="num">{link.endMark}</span> — splits the marks of both runs
      </>
    ) : (
      'Printed on the sheath where the box is'
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Insert TJ box into cable"
      subtitle={
        <span className="num">
          {from?.name} → <span className="text-accent">{boxLabel}</span> → {to?.name}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={insert.isPending} disabled={!!blocked} title={blocked ?? undefined}>
            <Box className="size-4" /> Insert box
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-hairline bg-surface p-1" role="tablist" aria-label="Box">
          {(
            [
              ['new', 'New TJ box'],
              ['existing', 'Existing TJ box'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mode === v}
              onClick={() => setMode(v)}
              className={clsx(
                'flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors',
                mode === v ? 'bg-primary text-on-primary' : 'text-muted-strong hover:text-strong',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'new' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} numeric />
            </Field>
            <Field label="Splice positions" hint={n > 4 ? <>At least <span className="num">{n}</span> for this cable</> : undefined}>
              <Input value={ports} onChange={(e) => setPorts(e.target.value)} numeric inputMode="numeric" />
            </Field>
            <Field label="Latitude">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} onPaste={onCoordPaste} numeric inputMode="decimal" />
            </Field>
            <Field label="Longitude">
              <Input value={lng} onChange={(e) => setLng(e.target.value)} onPaste={onCoordPaste} numeric inputMode="decimal" />
            </Field>
            <div className="col-span-2 -mt-1 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={pasteCoords} title="Paste “lat, lng” from the clipboard">
                <ClipboardPaste className="size-4" /> Paste
              </Button>
              <Button size="sm" variant="ghost" onClick={placeMidway} disabled={!route} title={route ? 'Halfway along the cable route' : 'Both ends need GPS'}>
                <MapPin className="size-4" /> Midway on route
              </Button>
            </div>
            <Field label="Address / landmark" className="col-span-2">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Pole, junction, shop…" />
            </Field>
          </div>
        ) : (
          <Field label="TJ box" hint="Needs a free splice position (In N and Out N) for every core">
            <Select value={boxId} onChange={(e) => setBoxId(e.target.value)}>
              {!boxes.length && <option value="">No other TJ boxes</option>}
              {boxes.map(({ node: x, free }) => (
                <option key={x.id} value={x.id} disabled={free < n}>
                  {x.name} · {free} free{x.address ? ` · ${x.address}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {cores.length > 1 && (
          <label className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-strong">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#FCD535]" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
            <span>
              All <span className="num">{cores.length}</span> cores of cable <span className="num">{link.cableCode}</span>
              <span className="block text-xs text-muted">
                {whole ? 'The whole cable is cut and every core spliced straight through the box.' : `Only core #${link.coreNumber ?? '?'} goes through the box.`}
              </span>
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Meter mark at box" hint={marksHint}>
            <Input value={mark} onChange={(e) => setMark(e.target.value)} numeric inputMode="numeric" trailing="m" />
          </Field>
          <Field
            label={`Length ${from?.name ?? ''} → box`}
            hint={
              link.length != null ? (
                <>
                  Of <span className="num">{fmtLength(link.length)}</span> total; the rest goes to the second run
                </>
              ) : (
                'Optional'
              )
            }
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <Input value={toBox} onChange={(e) => setToBox(e.target.value)} numeric inputMode="numeric" trailing="m" />
              </div>
              {gpsToBox != null && (
                <Button size="md" variant="secondary" onClick={() => setToBox(String(Math.round(gpsToBox)))} title="Straight-line GPS distance">
                  <Ruler className="size-4" />
                </Button>
              )}
            </div>
          </Field>
        </div>

        <ul className="space-y-0.5 rounded-lg border border-hairline p-2 text-[13px]">
          {(whole ? cores : [link]).map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 px-1 py-1">
              <ColorDot color={c.coreColor} />
              <span className="num w-8 text-muted-strong">{c.coreNumber != null ? `#${c.coreNumber}` : '—'}</span>
              <span className="num min-w-0 truncate text-strong">{from && c.fromPort != null ? portName(from, c.fromPort) : from?.name}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted" />
              <span className="num shrink-0 text-accent">{boxLabel}{mode === 'new' ? ` · In ${i + 1}` : ''}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted" />
              <span className="num min-w-0 truncate text-muted-strong">{to?.name}{c.toPort != null ? ` · In ${c.toPort}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

const NEW_CABLE = '__new__';

/** Dialog for a new core: after dragging a connection on the schematic, or "Add core" on a cable. */
export function NewLinkModal({ draft, ix, onClose, onCreated }: { draft: LinkDraft | null; ix: NetIndex; onClose: () => void; onCreated: (l: FiberLink) => void }) {
  const create = useCreateLink();
  const form = useForm<LinkValues>({ resolver: zodResolver(fiberLinkUpdateSchema) as never, defaultValues: linkValues({}) });
  const from = draft ? ix.nodes.get(draft.fromNodeId) : undefined;
  const to = draft ? ix.nodes.get(draft.toNodeId) : undefined;
  const gps = draft ? routeLength(ix, draft.fromNodeId, draft.toNodeId, null) : null;
  const [fromPort, setFromPort] = useState<number | null>(null);
  const [toPort, setToPort] = useState<number | null>(null);
  const [cable, setCable] = useState(NEW_CABLE);

  // Existing multi-core cables already running between these two devices.
  const cables = useMemo(() => {
    if (!draft) return [];
    const prefix = `${draft.fromNodeId}>${draft.toNodeId}>`;
    return [...ix.cables.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, cores]) => ({ key, cores }));
  }, [draft, ix]);
  const chosen = cables.find((c) => c.key === cable);

  const fill = (key: string) => {
    if (!draft || !from) return;
    const c = cables.find((x) => x.key === key);
    if (c) {
      const l = c.cores[0]!;
      const core = nextFreeCore(c.cores, l.coreCount);
      form.reset(
        linkValues({
          cableCode: l.cableCode,
          coreCount: l.coreCount,
          tubeColor: l.tubeColor,
          coreNumber: core,
          coreColor: core != null ? fiberColorFor(core) : null,
          length: l.length,
          startMark: l.startMark,
          endMark: l.endMark,
        }),
      );
      return;
    }
    // New cable. Splitter output fiber takes the port's standard color; reuse a sibling core's cable ID.
    const sibling = (ix.out.get(from.id) ?? []).find((l) => l.cableCode);
    // Leaving a TJ box: the core usually continues in the cable it arrived on.
    const feed = from.type === 'TJ_BOX' && draft.fromPort != null ? ix.inBySlot.get(`${from.id}:${draft.fromPort}`) : undefined;
    const code = from.type === 'SPLITTER' ? null : (feed?.cableCode ?? sibling?.cableCode ?? null);
    form.reset(
      linkValues({
        // Don't silently join an existing cable to the same device: new cable starts without an ID then.
        cableCode: cables.some((x) => x.cores[0]!.cableCode === code) ? null : code,
        // Continuing an existing cable keeps its core count; otherwise default to the common 4-core drop.
        coreCount: (feed?.cableCode && feed.cableCode === code ? feed.coreCount : null) ?? 4,
        tubeColor: 'Black',
        coreNumber: 1,
        coreColor: from.type === 'SPLITTER' && draft.fromPort ? fiberColorFor(draft.fromPort) : 'Blue',
        length: gps != null ? Math.round(gps) : null,
      }),
    );
  };

  useEffect(() => {
    if (!draft) return;
    setFromPort(draft.fromPort);
    setToPort(to?.type === 'TJ_BOX' ? (draft.toPort ?? (to ? freeInSlots(ix, to)[0] : null) ?? null) : null);
    const prefix = `${draft.fromNodeId}>${draft.toNodeId}>`;
    const keys = [...ix.cables.keys()].filter((k) => k.startsWith(prefix));
    const pre = draft.cableCode ? cableKey({ ...draft, cableCode: draft.cableCode }) : null;
    // Default to an existing cable between the two devices — the usual case is "another core of the same cable".
    const key = pre && keys.includes(pre) ? pre : (keys[0] ?? NEW_CABLE);
    setCable(key);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (draft) fill(cable);
  }, [draft, cable]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromPorts = from ? [...new Set([...(draft?.fromPort != null ? [draft.fromPort] : []), ...freeOutPorts(ix, from)])].sort((a, b) => a - b) : [];
  const toSlots = to?.type === 'TJ_BOX' ? [...new Set([...(draft?.toPort != null ? [draft.toPort] : []), ...freeInSlots(ix, to)])].sort((a, b) => a - b) : [];

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const link = await create.mutateAsync({ ...draft!, fromPort, toPort, ...(v as object) });
      toast.success(chosen ? `Core #${link.coreNumber ?? '?'} added to cable ${link.cableCode}` : `Cable ${from?.name} → ${to?.name} added`);
      onCreated(link);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={chosen ? 'Add core to cable' : 'New fiber cable'}
      subtitle={
        <span className="num">
          {from?.name}
          {from && fromPort != null ? ` · ${portName(from, fromPort)}` : ''} → {to?.name}
          {toPort != null ? ` · In ${toPort}` : ''}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting} disabled={fromPort == null || (to?.type === 'TJ_BOX' && toPort == null)}>
            {chosen ? 'Add core' : 'Add cable'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={from?.type === 'OLT' ? 'From PON port' : from?.type === 'TJ_BOX' ? 'From out port' : 'From output'}>
            <Select value={fromPort ?? ''} onChange={(e) => setFromPort(e.target.value ? Number(e.target.value) : null)}>
              {!fromPorts.length && <option value="">No free port</option>}
              {fromPorts.map((p) => (
                <option key={p} value={p}>
                  {from ? portName(from, p) : p}
                </option>
              ))}
            </Select>
          </Field>
          {to?.type === 'TJ_BOX' ? (
            <Field label="Into splice position" hint={toPort != null ? <>Continues out on <span className="num">Out {toPort}</span></> : undefined}>
              <Select value={toPort ?? ''} onChange={(e) => setToPort(e.target.value ? Number(e.target.value) : null)}>
                {!toSlots.length && <option value="">No free position</option>}
                {toSlots.map((p) => (
                  <option key={p} value={p}>
                    In {p}
                  </option>
                ))}
              </Select>
            </Field>
          ) : to?.type === 'OLT' ? (
            <Field label="Into" hint="Backbone feed for the OLT">
              <Input value="Uplink" readOnly />
            </Field>
          ) : (
            <div />
          )}
          {cables.length > 0 && (
            <Field label="Cable" className="col-span-2" hint={chosen ? 'Another core of a cable already laid between these devices' : 'A separate physical cable'}>
              <Select value={cable} onChange={(e) => setCable(e.target.value)}>
                {cables.map(({ key, cores }) => {
                  const l = cores[0]!;
                  const full = l.coreCount != null && cores.length >= l.coreCount;
                  return (
                    <option key={key} value={key} disabled={full}>
                      {l.cableCode} · {cores.length}
                      {l.coreCount ? `/${l.coreCount}` : ''} cores used{l.length != null ? ` · ${fmtLength(l.length)}` : ''}
                      {full ? ' (full)' : ''}
                    </option>
                  );
                })}
                <option value={NEW_CABLE}>New cable…</option>
              </Select>
            </Field>
          )}
        </div>
        <LinkFields
          form={form}
          ro={false}
          gpsLength={gps}
          sharedWith={chosen?.cores.length ?? 0}
          usedCores={chosen?.cores.map((c) => c.coreNumber).filter((n): n is number => n != null)}
        />
      </form>
    </Modal>
  );
}

// ---- Customer inspector -----------------------------------------------------
export function CustomerInspector({ id, ix, canManage, onSelect }: { id: string; ix: NetIndex; canManage: boolean; onSelect: (s: Selection | null) => void }) {
  const unassign = useUnassignPort();
  const c = ix.customers.get(id);
  if (!c) return null;
  const sp = ix.nodes.get(c.fiberNodeId);
  const color = c.splitterPort ? fiberColorFor(c.splitterPort) : null;
  return (
    <div>
      <PanelHeader icon={<MapPin className="size-[18px]" />} title={c.name} sub={<span className="num">{c.customerCode} · {c.phone}</span>} badge={<StatusBadge status={c.status} />} onClose={() => onSelect(null)} />
      <Section title="Connection">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div>
            <dt className="text-xs text-muted">Splitter</dt>
            <dd>
              <button type="button" className="num text-strong hover:text-accent" onClick={() => sp && onSelect({ kind: 'node', id: sp.id })}>
                {sp?.name ?? '—'}
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Port</dt>
            <dd className="flex items-center gap-2 text-strong">
              <span className="num">P{c.splitterPort}</span> <ColorDot color={color} /> {color}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">ONU serial</dt>
            <dd className="num text-strong">{c.onuSerial ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">RX power</dt>
            <dd className={clsx('num', c.rxPower == null ? 'text-muted' : c.rxPower < -27 ? 'text-down' : c.rxPower < -25 ? 'text-warn' : 'text-up')}>
              {c.rxPower != null ? `${c.rxPower.toFixed(2)} dBm` : '—'}
            </dd>
          </div>
        </dl>
        {c.latitude == null && <p className="mt-3 text-xs text-muted">No GPS on the customer profile, so the drop is not drawn on the map.</p>}
      </Section>
      <div className="flex flex-wrap gap-2 border-t border-hairline px-5 py-4">
        <Link to={`/customers/${c.id}`}>
          <Button size="sm" variant="secondary">
            <ExternalLink className="size-4" /> Open profile
          </Button>
        </Link>
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            loading={unassign.isPending}
            onClick={async () => {
              try {
                await unassign.mutateAsync(c.id);
                toast.success(`${c.name} disconnected`);
                onSelect(sp ? { kind: 'node', id: sp.id } : null);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <Unplug className="size-4" /> Disconnect from port
          </Button>
        )}
      </div>
    </div>
  );
}

// ---- Overview (nothing selected) -------------------------------------------
export function Overview({ net, ix, onSelect }: { net: FiberNetwork; ix: NetIndex; onSelect: (s: Selection) => void }) {
  const [q, setQ] = useState('');
  const stats = useMemo(() => {
    const splitters = net.nodes.filter((n) => n.type === 'SPLITTER');
    const totalPorts = splitters.reduce((s, n) => s + outputPorts(n), 0);
    const usedPorts = splitters.reduce(
      (s, n) => s + Array.from({ length: outputPorts(n) }, (_, i) => i + 1).filter((p) => ix.custByPort.has(`${n.id}:${p}`) || ix.outByPort.has(`${n.id}:${p}`)).length,
      0,
    );
    return {
      olt: net.nodes.filter((n) => n.type === 'OLT').length,
      box: net.nodes.filter((n) => n.type === 'TJ_BOX').length,
      splitters: splitters.length,
      // Cores of one multi-core cable share its length — count each physical cable once.
      cableM: net.links.filter((l) => cableCores(ix, l)[0] === l).reduce((s, l) => s + (l.length ?? 0), 0),
      customers: net.customers.length,
      freePorts: totalPorts - usedPorts,
      noGps: net.nodes.filter((n) => nodePos(ix, n) == null).length,
    };
  }, [net, ix]);
  const list = net.nodes.filter((n) => !q || n.name.toLowerCase().includes(q.toLowerCase()));

  const tiles: [string, ReactNode][] = [
    ['OLTs', stats.olt],
    ['TJ boxes', stats.box],
    ['Splitters', stats.splitters],
    ['Cable laid', fmtLength(stats.cableM)],
    ['Customers patched', stats.customers],
    ['Free splitter ports', stats.freePorts],
  ];

  return (
    <div>
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-base font-semibold text-strong">Network overview</h3>
        <p className="mt-0.5 text-[13px] text-muted">Select anything on the canvas or map to edit it.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-5 pb-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] text-muted">{label}</p>
            <p className="num mt-0.5 text-lg font-semibold text-strong">{value}</p>
          </div>
        ))}
      </div>
      {stats.noGps > 0 && (
        <p className="mx-5 mb-4 rounded-lg border border-hairline px-3 py-2 text-xs text-muted-strong">
          <span className="num text-warn">{stats.noGps}</span> device{stats.noGps > 1 ? 's have' : ' has'} no GPS location and won’t appear on the map.
        </p>
      )}
      <Section title="How to build">
        <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-muted-strong">
          <li>Drag an <b className="text-strong">OLT</b>, <b className="text-strong">TJ box</b> or <b className="text-strong">Splitter</b> from the toolbar onto the canvas (or map to drop it at that GPS spot). Splitters have no GPS of their own — set the TJ box they sit in, or drop them on a TJ box pin.</li>
          <li>Drag from a port dot on the right of a device onto the next device to lay a cable, then fill in cable ID, core and length. On a TJ box, drop onto a splice position’s left dot — that core continues out on the same-numbered port.</li>
          <li>One cable, several cores: drag another port onto the same device and pick the existing cable, or select a cable and use <b className="text-strong">Add core</b>. Length, marks and route stay in sync across its cores.</li>
          <li>Select a splitter and use <b className="text-strong">+ Customer</b> on a free port — the customer’s fiber details fill in automatically.</li>
        </ol>
      </Section>
      <Section title={`Devices · ${net.nodes.length}`}>
        <Input placeholder="Find device…" leading={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find device" />
        <ul className="mt-2 space-y-0.5">
          {list.map((n) => {
            const Icon = NODE_ICON[n.type];
            return (
              <li key={n.id}>
                <RowButton onClick={() => onSelect({ kind: 'node', id: n.id })}>
                  <Icon className="size-4 text-accent" />
                  <span className="num truncate text-strong">{n.name}</span>
                  <span className="ml-auto text-xs text-muted">{n.type === 'SPLITTER' ? n.splitterRatio : FIBER_NODE_LABELS[n.type]}</span>
                </RowButton>
              </li>
            );
          })}
          {!list.length && <li className="px-2 py-3 text-[13px] text-muted">No devices{q ? ' match' : ' yet'}.</li>}
        </ul>
      </Section>
    </div>
  );
}

/**
 * Universal Google Maps link: opens maps.google.com on desktop, and the Google Maps app on
 * Android / iOS when installed (the OS hands the URL to the app). Null when coords are invalid.
 */
function googleMapsUrl(lat: unknown, lng: unknown): string | null {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat === '' || lng === '' || lat == null || lng == null) return null;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${la},${lo}`;
}
