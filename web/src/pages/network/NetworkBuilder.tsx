import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { ChevronsDownUp, ChevronsUpDown, Crosshair, LayoutGrid, List, Map as MapIcon, Maximize, MousePointerClick, PanelBottomOpen, Undo2, Workflow, X } from 'lucide-react';
import { FIBER_NODE_LABELS, FIBER_NODE_TYPES, type FiberLink, type FiberNode, type FiberNodeType } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { useCreateNode, useNetwork, useSavePositions, useUpdateLink, useUpdateNode } from '@/lib/queries';
import { distanceM, fmtLength, indexNetwork, nextName, nodePos, polylineM, type LatLng } from '@/lib/fiber';
import { Button, Card, EmptyState, PageLoader } from '@/components/ui';
import { autoLayout, displayHeight, nestBox, Schematic, type LinkDraft, type SchematicApi } from './Schematic';
import { currentPosition, NetworkMap } from './NetworkMap';
import { COMPACT_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { CustomerInspector, LinkInspector, NewLinkModal, NODE_ICON, NodeInspector, Overview } from './Inspector';
import { DND_TYPE, type Selection } from './types';

type View = 'schematic' | 'map';

/** A splitter dropped this close to a TJ box on the map is installed in that box. */
const SNAP_TO_BOX_M = 100;

/** TJ boxes expanded on the schematic (UI preference, kept per browser). */
const EXPANDED_KEY = 'isp.network.expandedBoxes';
function loadExpanded(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function NetworkBuilderPage() {
  const { can } = useAuth();
  const canManage = can('network:manage');
  const { data: net, isLoading, error } = useNetwork();
  const ix = useMemo(() => (net ? indexNetwork(net) : null), [net]);
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(params.get('view') === 'map' ? 'map' : 'schematic');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [placing, setPlacing] = useState<FiberNode | null>(null);
  const [route, setRoute] = useState<{ link: FiberLink; points: LatLng[] } | null>(null);
  /** New device waiting for a map tap (phones/tablets can't drag & drop from the toolbar). */
  const [adding, setAdding] = useState<FiberNodeType | null>(null);
  const [locating, setLocating] = useState(false);
  const compact = useMediaQuery(COMPACT_QUERY);
  /** Phones/tablets: the inspector is a bottom sheet over the canvas. */
  const [sheet, setSheet] = useState(false);
  const flow = useRef<SchematicApi>(null);
  const [expanded, setExpandedState] = useState<ReadonlySet<string>>(loadExpanded);
  const setExpanded = useCallback((fn: (prev: ReadonlySet<string>) => Set<string>) => {
    setExpandedState((prev) => {
      const next = fn(prev);
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);
  const toggleBox = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [setExpanded],
  );
  const expandBox = useCallback((id: string) => setExpanded((prev) => (prev.has(id) ? new Set(prev) : new Set(prev).add(id))), [setExpanded]);

  const createNode = useCreateNode();
  const updateNode = useUpdateNode();
  const updateLink = useUpdateLink();
  const savePositions = useSavePositions();

  // Deep links: /network?customer=ID or ?node=ID
  useEffect(() => {
    if (!ix) return;
    const cust = params.get('customer');
    const node = params.get('node');
    if (cust && ix.customers.has(cust)) setSelection({ kind: 'customer', id: cust });
    else if (node && ix.nodes.has(node)) setSelection({ kind: 'node', id: node });
    if (cust || node) {
      const n = cust ? ix.customers.get(cust)?.fiberNodeId : node;
      if (n) setTimeout(() => flow.current?.focus(n), 300);
      setParams({}, { replace: true });
    }
  }, [ix]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Canvas/map selection: tapping a device (even the selected one) shows its panel on phones. */
  const select = useCallback((s: Selection | null) => {
    setSelection(s);
    setSheet(!!s);
  }, []);

  // Phones/tablets: a new selection slides the inspector up; clearing it hides the sheet.
  useEffect(() => setSheet(!!selection), [selection?.kind, selection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a splitter (or its customer) hidden in a collapsed TJ box opens that box.
  useEffect(() => {
    if (!ix || !selection || selection.kind === 'link') return;
    const nodeId = selection.kind === 'node' ? selection.id : ix.customers.get(selection.id)?.fiberNodeId;
    const box = nestBox(ix, nodeId ? ix.nodes.get(nodeId) : undefined);
    if (box && !expanded.has(box.id)) expandBox(box.id);
  }, [selection, ix]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchView = (v: View) => {
    setView(v);
    if (v === 'schematic') {
      setPlacing(null);
      setRoute(null);
      setAdding(null);
    }
  };

  const cancelModes = useCallback(() => {
    setPlacing(null);
    setRoute(null);
    setAdding(null);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelModes();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelModes]);

  // ---- Creating devices ----------------------------------------------------
  const create = async (type: FiberNodeType, opts: { pos?: { x: number; y: number }; lat?: number; lng?: number; boxId?: string }) => {
    if (!net || !ix) return;
    let { lat, lng } = opts;
    let boxId: string | null = type === 'SPLITTER' ? (opts.boxId ?? null) : null;
    // Splitters have no GPS of their own: a map drop puts it inside the nearest TJ box.
    if (type === 'SPLITTER' && lat != null && lng != null) {
      const box = net.nodes
        .filter((n) => n.type === 'TJ_BOX' && n.latitude != null && n.longitude != null)
        .map((b) => ({ b, d: distanceM([lat!, lng!], [b.latitude!, b.longitude!]) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!box || box.d > SNAP_TO_BOX_M) {
        toast.error('Drop the splitter on a TJ box pin — splitters sit inside a TJ box');
        return;
      }
      boxId = box.b.id;
    }
    if (type === 'SPLITTER') {
      lat = undefined;
      lng = undefined;
    }
    // Map drops still need a canvas spot: put new devices below everything else.
    const free = net.nodes.filter((n) => !nestBox(ix, n));
    const pos =
      opts.pos ??
      (free.length ? { x: 0, y: Math.max(...free.map((n) => n.posY + displayHeight(n, ix, expanded, canManage))) + 48 } : { x: 0, y: 0 });
    try {
      const node = await createNode.mutateAsync({
        type,
        name: nextName(net.nodes, type),
        posX: Math.round(pos.x),
        posY: Math.round(pos.y),
        latitude: lat ?? null,
        longitude: lng ?? null,
        boxId,
      });
      if (boxId) expandBox(boxId);
      setSelection({ kind: 'node', id: node.id });
      toast.success(`${node.name} added${boxId ? ` inside ${ix.nodes.get(boxId)?.name}` : ''} — rename it in the panel`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const createRef = useRef(create);
  createRef.current = create;
  const addSplitter = useCallback((boxId: string) => void createRef.current('SPLITTER', { boxId }), []);

  const quickAdd = (type: FiberNodeType) => {
    if (view === 'schematic') return create(type, { pos: flow.current?.center() });
    // Map: tap (or click) where it goes — or drag the button onto the map on desktop.
    setPlacing(null);
    setRoute(null);
    setAdding(type);
    setSheet(false);
  };

  // ---- Map interactions ------------------------------------------------------
  const startPlacing = (n: FiberNode) => {
    setView('map');
    setRoute(null);
    setAdding(null);
    setPlacing(n);
    setSheet(false);
  };

  /** "Use my GPS" in the place / add banner: drop at the phone's current position. */
  const dropAtMyGps = async () => {
    setLocating(true);
    try {
      const [lat, lng] = await currentPosition();
      if (adding) {
        const t = adding;
        setAdding(null);
        await create(t, { lat, lng });
      } else await place(lat, lng);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLocating(false);
    }
  };

  const place = async (lat: number, lng: number) => {
    if (!placing) return;
    const n = placing;
    setPlacing(null);
    try {
      await updateNode.mutateAsync({ id: n.id, latitude: lat, longitude: lng });
      toast.success(`${n.name} placed at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const moveNode = async (id: string, lat: number, lng: number) => {
    try {
      await updateNode.mutateAsync({ id, latitude: lat, longitude: lng });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const routeEnds = route && ix ? [nodePos(ix, ix.nodes.get(route.link.fromNodeId)), nodePos(ix, ix.nodes.get(route.link.toNodeId))] : null;
  const routeLen = route && routeEnds?.[0] && routeEnds[1] ? polylineM([routeEnds[0], ...route.points, routeEnds[1]]) : null;

  const saveRoute = async () => {
    if (!route) return;
    const { link, points } = route;
    const len = routeLen != null ? Math.round(routeLen) : null;
    try {
      // First route on a cable without a length: take the drawn length.
      await updateLink.mutateAsync({ id: link.id, path: points, ...(link.length == null && len != null ? { length: len } : {}) });
      setRoute(null);
      if (link.length != null && len != null && Math.abs(link.length - len) > 5) {
        toast.success('Route saved', {
          description: `Drawn route is ${fmtLength(len)}; cable length is ${fmtLength(link.length)}.`,
          action: { label: `Use ${fmtLength(len)}`, onClick: () => updateLink.mutate({ id: link.id, length: len }) },
        });
      } else toast.success('Route saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (isLoading) return <PageLoader />;
  if (error || !net || !ix) return <EmptyState title="Could not load the network" message={errorMessage(error)} />;

  const selNode = selection?.kind === 'node' ? ix.nodes.get(selection.id) : undefined;
  const selLink = selection?.kind === 'link' ? ix.links.get(selection.id) : undefined;
  const empty = net.nodes.length === 0;

  return (
    // Fills the viewport under the top bar (64px) minus <main>'s vertical padding (48px phone / 64px md+).
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-64px)] flex-col gap-2 px-2 py-2 sm:mx-0 sm:my-0 sm:h-[calc(100dvh-64px-48px)] sm:gap-4 sm:px-0 sm:py-0 md:h-[calc(100dvh-64px-64px)]">
      {/* Title + toolbar */}
      <div className="flex flex-col gap-2 sm:gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="hidden sm:block">
          <h1 className="text-2xl font-bold tracking-tight text-strong md:text-[28px]">Network map</h1>
          <p className="mt-1 text-sm text-muted">OLT → PON → cable → TJ box → splitter → customer, with GPS and core colors.</p>
        </div>
        <div className="scrollbar-thin -mx-2 flex items-center gap-2 overflow-x-auto px-2 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {canManage && (
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-surface p-1" role="toolbar" aria-label="Add device">
              <span className="hidden px-2 text-xs text-muted sm:inline">Add</span>
              {FIBER_NODE_TYPES.map((t) => {
                const Icon = NODE_ICON[t];
                return (
                  <button
                    key={t}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, t);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => quickAdd(t)}
                    title={view === 'map' ? 'Click, then click the map where it goes — or drag onto the map' : 'Click to add, or drag onto the canvas'}
                    aria-pressed={adding === t}
                    className={clsx(
                      'flex h-9 shrink-0 cursor-grab items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap active:cursor-grabbing sm:h-8',
                      adding === t ? 'bg-primary text-on-primary' : 'text-strong hover:bg-surface-2',
                    )}
                  >
                    <Icon className={clsx('size-4', adding === t ? '' : 'text-accent')} /> {FIBER_NODE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          )}
          <div className="order-first flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-surface p-1 sm:order-none" role="tablist" aria-label="View">
            {(
              [
                ['schematic', 'Schematic', Workflow],
                ['map', 'Map', MapIcon],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => switchView(v)}
                className={clsx(
                  'flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors sm:h-8',
                  view === v ? 'bg-primary text-on-primary' : 'text-muted-strong hover:text-strong',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {view === 'schematic' && !empty && (
            <>
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-10 shrink-0"
                  aria-label="Auto-arrange"
                  loading={savePositions.isPending}
                  onClick={async () => {
                    await savePositions.mutateAsync(autoLayout(net, ix, expanded, canManage)).catch((e) => toast.error(errorMessage(e)));
                    setTimeout(() => flow.current?.fitView(), 50);
                  }}
                >
                  <LayoutGrid className="size-4" /> <span className="hidden sm:inline">Auto-arrange</span>
                </Button>
              )}
              {ix.splittersInBox.size > 0 &&
                (() => {
                  const withSplitters = [...ix.splittersInBox.keys()].filter((id) => ix.nodes.get(id)?.type === 'TJ_BOX');
                  const allOpen = withSplitters.every((id) => expanded.has(id));
                  return (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-10 shrink-0"
                      aria-label={allOpen ? 'Collapse boxes' : 'Expand boxes'}
                      title={allOpen ? 'Hide splitters inside TJ boxes' : 'Show splitters inside every TJ box'}
                      onClick={() => setExpanded(() => (allOpen ? new Set() : new Set(withSplitters)))}
                    >
                      {allOpen ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}{' '}
                      <span className="hidden sm:inline">{allOpen ? 'Collapse boxes' : 'Expand boxes'}</span>
                    </Button>
                  );
                })()}
              <Button variant="secondary" size="sm" className="h-10 shrink-0" aria-label="Fit to screen" onClick={() => flow.current?.fitView()}>
                <Maximize className="size-4" /> <span className="hidden sm:inline">Fit</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* `isolate` keeps Leaflet's z-indexes inside the card, under the bottom sheet and modals. */}
        <Card className="relative isolate min-h-[320px] flex-1 overflow-hidden border border-hairline">
          {view === 'schematic' ? (
            <Schematic
              net={net}
              ix={ix}
              selection={selection}
              onSelect={select}
              canManage={canManage}
              compact={compact}
              onConnect={setDraft}
              onCreateAt={(type, pos, boxId) => create(type, { pos, boxId })}
              onMoved={(p) => p.length && savePositions.mutate(p, { onError: (e) => toast.error(errorMessage(e)) })}
              expanded={expanded}
              onToggleBox={toggleBox}
              onAddSplitter={addSplitter}
              apiRef={flow}
            />
          ) : (
            <NetworkMap
              net={net}
              ix={ix}
              selection={selection}
              onSelect={select}
              canManage={canManage}
              placing={placing}
              onPlace={place}
              route={route && { linkId: route.link.id, points: route.points }}
              onRoutePoint={(p) => setRoute((r) => r && { ...r, points: [...r.points, p] })}
              onMoveNode={moveNode}
              onCreateAt={(type, lat, lng) => {
                setAdding(null);
                void create(type, { lat, lng });
              }}
              adding={adding}
            />
          )}

          {empty && view === 'schematic' && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="max-w-sm rounded-xl border border-hairline bg-surface p-6 text-center">
                <MousePointerClick className="mx-auto mb-3 size-8 text-accent" />
                <p className="font-semibold text-strong">Start with your OLT</p>
                <p className="mt-1 text-sm text-muted">
                  {canManage ? 'Drag “OLT” from the toolbar onto this canvas, then add TJ boxes and splitters and connect their ports.' : 'No network has been drawn yet.'}
                </p>
              </div>
            </div>
          )}

          {/* Mode banners (map) */}
          {view === 'map' && (placing || route || adding) && (
            <div className="absolute top-3 right-16 left-14 z-[1000] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary/60 bg-surface px-3 py-2 text-[13px] shadow-lg sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:flex-nowrap sm:px-4">
              {placing || adding ? (
                <>
                  <span className="min-w-0 flex-1 text-strong sm:flex-none">
                    {placing ? (
                      <>
                        Tap the map to place <b className="num">{placing.name}</b>
                      </>
                    ) : adding === 'SPLITTER' ? (
                      <>Tap a TJ box pin to install a new splitter in it</>
                    ) : (
                      <>
                        Tap the map where the new <b>{FIBER_NODE_LABELS[adding!]}</b> goes
                      </>
                    )}
                  </span>
                  {adding !== 'SPLITTER' && (
                    <Button size="sm" variant="secondary" onClick={dropAtMyGps} loading={locating}>
                      <Crosshair className="size-4" /> My GPS
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <span className="w-full text-strong sm:w-auto">
                    Tap to add bend points · <span className="num">{route!.points.length}</span> points ·{' '}
                    <span className="num text-accent">{fmtLength(routeLen)}</span>
                  </span>
                  <Button size="sm" variant="ghost" disabled={!route!.points.length} onClick={() => setRoute((r) => r && { ...r, points: r.points.slice(0, -1) })}>
                    <Undo2 className="size-4" /> Undo
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!route!.points.length} onClick={() => setRoute((r) => r && { ...r, points: [] })}>
                    Clear
                  </Button>
                  <Button size="sm" onClick={saveRoute} loading={updateLink.isPending}>
                    Save route
                  </Button>
                </>
              )}
              <button type="button" onClick={cancelModes} className="ml-auto rounded-md p-2 text-muted hover:text-strong sm:ml-0 sm:p-1" aria-label="Cancel (Esc)">
                <X className="size-4" />
              </button>
            </div>
          )}
          {/* Phones/tablets: bring the inspector back when it is hidden. */}
          {compact && !sheet && !placing && !route && !adding && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="absolute bottom-7 left-1/2 z-[1000] flex h-11 max-w-[70%] -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-surface px-4 text-sm font-medium text-strong shadow-lg"
            >
              {selection ? <PanelBottomOpen className="size-4 shrink-0 text-accent" /> : <List className="size-4 shrink-0 text-accent" />}
              <span className="num truncate">
                {selNode?.name ?? (selLink ? (selLink.cableCode ?? 'Cable') : selection?.kind === 'customer' ? (ix.customers.get(selection.id)?.name ?? 'Customer') : 'Devices & details')}
              </span>
            </button>
          )}
        </Card>

        {compact && sheet && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSheet(false)} aria-hidden />}
        <Card
          className={clsx(
            'scrollbar-thin overflow-y-auto border border-hairline',
            compact
              ? clsx(
                  'fixed inset-x-0 bottom-0 z-40 max-h-[72dvh] rounded-b-none pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200',
                  sheet ? 'translate-y-0' : 'pointer-events-none translate-y-full',
                )
              : 'w-[380px] shrink-0 min-[1920px]:w-[420px]',
          )}
          inert={compact && !sheet}
        >
          {compact && (
            <div className="sticky top-0 z-10 flex justify-center bg-surface pt-2 pb-1">
              <button type="button" onClick={() => setSheet(false)} className="flex h-6 w-16 items-center justify-center" aria-label="Hide panel">
                <span className="h-1 w-10 rounded-full bg-surface-3" />
              </button>
            </div>
          )}
          {selNode ? (
            <NodeInspector
              key={selNode.id}
              node={selNode}
              net={net}
              ix={ix}
              canManage={canManage}
              onSelect={setSelection}
              onPickOnMap={startPlacing}
              onAddSplitter={addSplitter}
              onConnect={setDraft}
            />
          ) : selLink ? (
            <LinkInspector
              key={selLink.id}
              link={selLink}
              ix={ix}
              canManage={canManage}
              onSelect={setSelection}
              onAddCore={setDraft}
              onEditRoute={(l) => {
                setView('map');
                setPlacing(null);
                setAdding(null);
                setSheet(false);
                setRoute({ link: l, points: l.path ?? [] });
              }}
            />
          ) : selection?.kind === 'customer' ? (
            <CustomerInspector id={selection.id} ix={ix} canManage={canManage} onSelect={setSelection} />
          ) : (
            <Overview net={net} ix={ix} onSelect={(s) => {
              setSelection(s);
              if (view === 'schematic' && s.kind === 'node') flow.current?.focus(s.id);
            }} />
          )}
        </Card>
      </div>

      <NewLinkModal
        draft={draft}
        ix={ix}
        onClose={() => setDraft(null)}
        onCreated={(l) => {
          setDraft(null);
          setSelection({ kind: 'link', id: l.id });
        }}
      />
    </div>
  );
}
