const DEFAULT_OPTICAL_URL =
  'https://103.158.118.72:49152/action/onuoptical.html?ponid={ponId}&onuid={onuId}&select=1';

/** OLT admin-panel URL showing ONU optical info, or null if PON/ONU ID are missing. */
export function onuOpticalUrl(ponId: number | null, onuId: number | null): string | null {
  if (ponId == null || onuId == null) return null;
  const template = import.meta.env.VITE_OLT_OPTICAL_URL || DEFAULT_OPTICAL_URL;
  return template
    .replaceAll('{ponId}', encodeURIComponent(ponId))
    .replaceAll('{onuId}', encodeURIComponent(onuId));
}
