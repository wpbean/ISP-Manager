import { TileLayer } from 'react-leaflet';

export const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125]; // Dhaka

/**
 * OpenStreetMap standard tiles (no API key). In dark theme the tile pane is
 * inverted via CSS (see .leaflet-tile-pane in index.css) to sit on the dark canvas.
 * For heavy production traffic, switch to a keyed provider (OSM tile usage policy).
 */
export function MapTiles() {
  return (
    <TileLayer
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      maxZoom={19}
    />
  );
}

export const STATUS_COLORS = {
  ACTIVE: '#0ecb81',
  PENDING: '#3b82f6',
  SUSPENDED: '#FCD535',
  DISCONNECTED: '#f6465d',
} as const;
