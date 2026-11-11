import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { type Map as LeafletMap } from 'leaflet';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { LocateFixed } from 'lucide-react';
import { cableKey, fiberColorFor, type FiberLink, type FiberNetwork, type FiberNode, type FiberNodeType } from '@isp/shared';
import { useTheme } from '@/lib/theme';
import { fiberHex, fmtLength, fmtMarks, nodePos, type LatLng, type NetIndex } from '@/lib/fiber';
import { DEFAULT_CENTER, MapTiles, STATUS_COLORS } from '@/components/MapTiles';
import { useMediaQuery, TOUCH_QUERY } from '@/lib/useMediaQuery';
import { DND_TYPE, type Selection } from './types';

/** One high-accuracy GPS fix (needs HTTPS or localhost on phones). */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by this browser'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([round6(p.coords.latitude), round6(p.coords.longitude)]),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : err.message || 'Could not get location')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  });
}

const PIN_TEXT: Record<FiberNodeType, string> = { OLT: 'OLT', TJ_BOX: 'TJ', SPLITTER: 'SP' };
const iconCache = new Map<string, L.DivIcon>();
function pinIcon(type: FiberNodeType, selected: boolean) {
  const key = `${type}:${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div class="fiber-pin fiber-pin--${type.toLowerCase()}${selected ? ' fiber-pin--sel' : ''}">${PIN_TEXT[type]}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function FitOnce({ points }: { points: LatLng[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !points.length) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0]!, 16);
    else map.fitBounds(points, { padding: [48, 48], maxZoom: 17 });
  }, [points, map]);
  return null;
}

function MapRef({ onMap }: { onMap: (m: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

function Clicks({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Pan to the selected node if it is off-screen. */
function FollowSelection({ pos }: { pos: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos && !map.getBounds().contains(pos)) map.panTo(pos);
  }, [pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const round6 = (n: number) => Number(n.toFixed(6));

interface Props {
  net: FiberNetwork;
  ix: NetIndex;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  canManage: boolean;
  /** Node waiting for a map click to set its GPS. */
  placing: FiberNode | null;
  onPlace: (lat: number, lng: number) => void;
  /** Link whose route is being drawn, with the draft waypoints. */
  route: { linkId: string; points: LatLng[] } | null;
  onRoutePoint: (p: LatLng) => void;
  onMoveNode: (id: string, lat: number, lng: number) => void;
  onCreateAt: (type: FiberNodeType, lat: number, lng: number) => void;
  /** Device type waiting for a map tap to be created there (touch-friendly alternative to drag & drop). */
  adding: FiberNodeType | null;
}

export function NetworkMap({ net, ix, selection, onSelect, canManage, placing, onPlace, route, onRoutePoint, onMoveNode, onCreateAt, adding }: Props) {
  const touch = useMediaQuery(TOUCH_QUERY);
  const [me, setMe] = useState<{ pos: LatLng; busy: boolean } | null>(null);
  const locate = async () => {
    setMe((m) => (m ? { ...m, busy: true } : { pos: [0, 0], busy: true }));
    try {
      const pos = await currentPosition();
      setMe({ pos, busy: false });
      mapRef.current?.setView(pos, Math.max(mapRef.current.getZoom(), 17));
    } catch (e) {
      setMe((m) => (m && m.pos[0] !== 0 ? { ...m, busy: false } : null));
      toast.error((e as Error).message);
    }
  };
  const { theme } = useTheme();
  const halo = theme === 'dark' ? '#363c45' : '#d5d8dc'; // SVG attrs can't use CSS vars
  const ring = theme === 'dark' ? '#1e2329' : '#ffffff';
  const mapRef = useRef<LeafletMap | null>(null);
  const onMap = useMemo(() => (m: LeafletMap) => void (mapRef.current = m), []);

  // Nodes drawn as pins: OLTs and TJ boxes with GPS. Splitters have no GPS — they sit in their box's pin.
  const pins = net.nodes.filter((n) => n.type !== 'SPLITTER' && n.latitude != null && n.longitude != null);
  const allPoints = useMemo(() => {
    const pts: LatLng[] = pins.map((n) => [n.latitude!, n.longitude!]);
    net.customers.forEach((c) => c.latitude != null && c.longitude != null && pts.push([c.latitude, c.longitude]));
    return pts;
  }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  const selNode = selection?.kind === 'node' ? ix.nodes.get(selection.id) : undefined;
  // Physical cables: cores sharing a cable ID between the same two nodes, plus cores without an ID.
  const cables = useMemo(() => {
    const seen = new Set<string>();
    const out: FiberLink[][] = [];
    for (const l of net.links) {
      const k = cableKey(l);
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      out.push(k ? ix.cables.get(k)! : [l]);
    }
    return out;
  }, [net, ix]);

  const handleClick = (lat: number, lng: number) => {
    if (adding) onCreateAt(adding, round6(lat), round6(lng));
    else if (placing) onPlace(round6(lat), round6(lng));
    else if (route) onRoutePoint([round6(lat), round6(lng)]);
    else onSelect(null);
  };

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DND_TYPE) as FiberNodeType;
    if (!type || !mapRef.current) return;
    e.preventDefault();
    const ll = mapRef.current.mouseEventToLatLng(e.nativeEvent);
    onCreateAt(type, round6(ll.lat), round6(ll.lng));
  };

  return (
    <div
      className={clsx('relative h-full w-full', (placing || route || adding) && 'fiber-map-picking')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
    >
      <MapContainer center={DEFAULT_CENTER} zoom={13} className="h-full w-full" doubleClickZoom={!route}>
        <MapTiles />
        <MapRef onMap={onMap} />
        <FitOnce points={allPoints} />
        <Clicks onClick={handleClick} />
        <FollowSelection pos={nodePos(ix, selNode)} />
        {me && me.pos[0] !== 0 && (
          <CircleMarker center={me.pos} radius={8} pathOptions={{ color: '#FCD535', weight: 3, fillColor: '#181a20', fillOpacity: 1, interactive: false }} />
        )}

        {/* Cables — one line per physical cable; its cores share the route. */}
        {cables.map((cores) => {
          const l = cores[0]!;
          const a = nodePos(ix, ix.nodes.get(l.fromNodeId));
          const b = nodePos(ix, ix.nodes.get(l.toNodeId));
          if (!a || !b) return null;
          const editing = !!route && cores.some((c) => c.id === route.linkId);
          const pts: LatLng[] = [a, ...(editing ? route.points : (l.path ?? [])), b];
          const selCore = selection?.kind === 'link' ? cores.find((c) => c.id === selection.id) : undefined;
          const sel = !!selCore;
          const multi = cores.length > 1;
          const color = sel || editing ? '#FCD535' : multi ? '#929aa5' : (fiberHex(l.coreColor) ?? '#929aa5');
          const click = { click: () => onSelect({ kind: 'link', id: (selCore ?? l).id }) };
          return (
            <Fragment key={l.id}>
              <Polyline positions={pts} pathOptions={{ color: halo, weight: sel ? 9 : multi ? 8 : 7, opacity: 0.9, bubblingMouseEvents: false }} eventHandlers={click} />
              <Polyline
                positions={pts}
                pathOptions={{ color, weight: sel ? 4.5 : multi ? 4.5 : 3.5, dashArray: editing ? '8 6' : undefined, bubblingMouseEvents: false }}
                eventHandlers={click}
              >
                <Tooltip sticky>
                  <span className="num">
                    {l.cableCode ?? 'Cable'}
                    {multi
                      ? ` · ${cores.length}${l.coreCount ? `/${l.coreCount}` : ''} cores used (${cores.map((c) => (c.coreNumber != null ? `#${c.coreNumber}` : '?')).join(', ')})`
                      : `${l.coreNumber != null ? ` · core #${l.coreNumber}` : ''}${l.coreColor ? ` (${l.coreColor})` : ''}`}
                    {fmtMarks(l) ? ` · ${fmtMarks(l)}` : ''} · {fmtLength(l.length)}
                  </span>
                </Tooltip>
              </Polyline>
              {editing &&
                route.points.map((p, i) => (
                  <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#181a20', weight: 2, fillColor: '#FCD535', fillOpacity: 1 }} />
                ))}
            </Fragment>
          );
        })}

        {/* Customer drops */}
        {net.customers.map((c) => {
          if (c.latitude == null || c.longitude == null) return null;
          const sp = nodePos(ix, ix.nodes.get(c.fiberNodeId));
          const sel = selection?.kind === 'customer' && selection.id === c.id;
          return (
            <Fragment key={c.id}>
              {sp && (
                <Polyline
                  positions={[sp, [c.latitude, c.longitude]]}
                  pathOptions={{ color: fiberHex(fiberColorFor(c.splitterPort ?? 1)) ?? '#929aa5', weight: 2, dashArray: '4 4', opacity: 0.9, interactive: false }}
                />
              )}
              <CircleMarker
                center={[c.latitude, c.longitude]}
                radius={sel ? 8 : 6}
                pathOptions={{ color: sel ? '#FCD535' : ring, weight: 2, fillColor: STATUS_COLORS[c.status], fillOpacity: 1, bubblingMouseEvents: false }}
                eventHandlers={{ click: () => onSelect({ kind: 'customer', id: c.id }) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {c.name} <span className="num text-muted">· P{c.splitterPort}</span>
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}

        {/* Equipment pins */}
        {pins.map((n) => {
          const inside = ix.splittersInBox.get(n.id);
          return (
            <Marker
              key={n.id}
              position={[n.latitude!, n.longitude!]}
              icon={pinIcon(n.type, selection?.kind === 'node' && selection.id === n.id)}
              // On touch screens a pin only moves once selected, so panning can't drag it by accident.
              draggable={canManage && !placing && !route && !adding && (!touch || (selection?.kind === 'node' && selection.id === n.id))}
              zIndexOffset={n.type === 'OLT' ? 1000 : 500}
              eventHandlers={{
                // Adding a splitter: tapping a TJ box pin installs it in that box.
                click: () => (adding === 'SPLITTER' && n.type === 'TJ_BOX' ? onCreateAt('SPLITTER', n.latitude!, n.longitude!) : onSelect({ kind: 'node', id: n.id })),
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  onMoveNode(n.id, round6(ll.lat), round6(ll.lng));
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -16]}>
                <span className="num font-semibold">{n.name}</span>
                {inside?.length ? <span className="num text-muted"> · {inside.map((s) => s.name).join(', ')}</span> : null}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      <button
        type="button"
        onClick={locate}
        disabled={me?.busy}
        aria-label="Show my location"
        title="Show my location"
        className="absolute top-3 right-3 z-[1000] flex size-11 items-center justify-center rounded-md border border-hairline bg-surface text-strong shadow-md hover:bg-surface-2 disabled:opacity-60"
      >
        <LocateFixed className={clsx('size-5', me && !me.busy && 'text-accent', me?.busy && 'animate-pulse')} />
      </button>
    </div>
  );
}
