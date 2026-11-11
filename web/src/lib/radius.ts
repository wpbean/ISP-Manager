const DEFAULT_RADIUS_CLIENT_URL = 'https://radius.yetfix.com/admin/clients/{radiusId}';

/** RADIUS admin-panel URL for the customer's client page, or null if no RADIUS ID. */
export function radiusClientUrl(radiusId: number | null): string | null {
  if (radiusId == null) return null;
  const template = import.meta.env.VITE_RADIUS_CLIENT_URL || DEFAULT_RADIUS_CLIENT_URL;
  return template.replaceAll('{radiusId}', encodeURIComponent(radiusId));
}
