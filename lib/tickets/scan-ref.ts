/**
 * Normalize raw QR / manual scanner input to a ticket or order reference.
 *
 * Ticket PDFs may encode either:
 * - raw serial: KPY-48291-01
 * - public URL: https://…/scan?ref=KPY-48291-01
 */

/** Pull order middle from unit serial: KPY-48291-01 → KPY-48291 */
export function orderRefFromSerial(serial: string): string | null {
  const s = (serial || "").trim();
  const m = s.match(/^(.+)-(\d{2,3})$/);
  return m ? m[1] : null;
}

/**
 * Turn camera / paste input into the value we look up in purchases.
 */
export function normalizeScanRef(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "";

  // Full URL or path with ?ref=
  try {
    const url = new URL(s, "https://placeholder.local");
    const refParam = url.searchParams.get("ref");
    if (refParam && refParam.trim()) {
      return refParam.trim();
    }
  } catch {
    /* not a URL */
  }

  // Bare query string: ref=KPY-…
  const bare = s.match(/(?:^|[?&])ref=([^&\s#]+)/i);
  if (bare?.[1]) {
    try {
      return decodeURIComponent(bare[1]).trim();
    } catch {
      return bare[1].trim();
    }
  }

  // Path style: /scan/KPY-… or /scan?ref already handled
  const pathSerial = s.match(/\/scan\/([A-Za-z0-9._-]+)/i);
  if (pathSerial?.[1]) return pathSerial[1].trim();

  return s;
}
