import { TileLayer } from 'react-leaflet';

export const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125]; // Dhaka

/**
 * OpenStreetMap standard tiles (no API key). OSM's tile usage policy requires a
 * Referer header — tile requests without one get a 403 "Access blocked" image.
 * The deployed site sends `Referrer-Policy: same-origin`, which strips it for
 * cross-origin requests, so each tile <img> sets its own referrerPolicy to send
 * the site origin. Override with VITE_MAP_TILE_URL / VITE_MAP_TILE_ATTRIBUTION
 * (e.g. a keyed MapTiler/Stadia URL) for heavy production traffic.
 * In dark theme the tile pane is inverted via CSS (see .leaflet-tile-pane in index.css).
 */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MapTiles() {
  return (
    <TileLayer
      url={TILE_URL}
      attribution={TILE_ATTRIBUTION}
      maxZoom={19}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export const STATUS_COLORS = {
  ACTIVE: '#0ecb81',
  PENDING: '#3b82f6',
  SUSPENDED: '#FCD535',
  DISCONNECTED: '#f6465d',
} as const;
