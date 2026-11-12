/**
 * Pull a "lat, lng" pair out of pasted text: plain "23.9084, 90.2276" (Google Maps right-click copy),
 * space/tab separated, "lat: … lng: …", or a Google Maps URL ("@23.9,90.2,17z", "?q=23.9,90.2").
 * Returns null when no valid pair is found.
 */
export function parseLatLng(text: string): [number, number] | null {
  const t = text.trim();
  const at = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const nums = at ? [at[1], at[2]] : t.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = Number(nums[0]);
  const lng = Number(nums[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}
