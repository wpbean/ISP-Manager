import { TileLayer } from 'react-leaflet';

export const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125]; // Dhaka

/**
 * Basemap tiles. tile.openstreetmap.org rejects app traffic that doesn't meet its
 * tile usage policy (403 "Access blocked"), so we default to CARTO's free Voyager
 * basemap (OSM data, no API key, attribution required). Override with
 * VITE_MAP_TILE_URL / VITE_MAP_TILE_ATTRIBUTION (e.g. a keyed MapTiler/Stadia URL).
 * In dark theme the tile pane is inverted via CSS (see .leaflet-tile-pane in index.css).
 */
const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function MapTiles() {
  return (
    <TileLayer
      url={TILE_URL}
      attribution={TILE_ATTRIBUTION}
      subdomains="abcd"
      maxZoom={20}
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
