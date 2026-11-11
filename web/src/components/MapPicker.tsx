import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, useMap, useMapEvents } from 'react-leaflet';
import { Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { DEFAULT_CENTER, MapTiles } from './MapTiles';

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.setView(pos, Math.max(map.getZoom(), 16));
  }, [pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Click the map (or use device GPS) to set a customer's lat/long. */
export function MapPicker({
  lat,
  lng,
  onChange,
  disabled,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  disabled?: boolean;
}) {
  const pos: [number, number] | null = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) ? [lat, lng] : null;
  const [locating, setLocating] = useState(false);

  const pick = (a: number, b: number) => !disabled && onChange(Number(a.toFixed(6)), Number(b.toFixed(6)));

  const locate = () => {
    if (!navigator.geolocation) return toast.error('Geolocation is not supported by this browser');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        pick(p.coords.latitude, p.coords.longitude);
        setLocating(false);
      },
      (err) => {
        toast.error(`Could not get location: ${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="space-y-3">
      <div className="relative h-72 overflow-hidden rounded-lg border border-hairline">
        <MapContainer center={pos ?? DEFAULT_CENTER} zoom={pos ? 16 : 12} className="h-full w-full" scrollWheelZoom>
          <MapTiles />
          <ClickHandler onPick={pick} />
          <Recenter pos={pos} />
          {pos && (
            <CircleMarker center={pos} radius={9} pathOptions={{ color: '#181a20', weight: 2, fillColor: '#FCD535', fillOpacity: 1 }} />
          )}
        </MapContainer>
        {!disabled && (
          <p className="pointer-events-none absolute top-3 right-3 z-[400] rounded-md bg-surface/90 px-2.5 py-1 text-xs text-muted-strong">
            Click the map to set the location
          </p>
        )}
      </div>
      {!disabled && (
        <Button variant="secondary" size="sm" onClick={locate} loading={locating}>
          <Crosshair className="size-4" /> Use my current location
        </Button>
      )}
    </div>
  );
}
