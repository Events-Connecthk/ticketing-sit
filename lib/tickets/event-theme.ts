/**
 * Optional per-event brand colours for the public ticketing page.
 * Stored in event.metadata.primaryColor / secondaryColor.
 * Missing or invalid values → current white-gold defaults (no visual change).
 */

export const DEFAULT_PRIMARY = "#C5A26E";
export const DEFAULT_SECONDARY = "#6B5E50";
export const DEFAULT_PAGE_BG = "#FAF8F5";
export const DEFAULT_BORDER = "#EDE4D3";
export const DEFAULT_TEXT = "#2C2520";

export function normalizeHexColor(
  value: unknown,
  fallback: string
): string {
  const s = String(value ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function shadeHex(hex: string, amount: number): string {
  const raw = normalizeHexColor(hex, DEFAULT_PRIMARY).slice(1);
  const n = parseInt(raw, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amount >= 0) {
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
  } else {
    const f = 1 + amount;
    r = Math.round(r * f);
    g = Math.round(g * f);
    b = Math.round(b * f);
  }
  const clamp = (x: number) => Math.max(0, Math.min(255, x));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export type EventTheme = {
  primary: string;
  secondary: string;
  primaryDark: string;
  primaryLight: string;
  pageBg: string;
  border: string;
  text: string;
  /** CSS custom properties for the event page root */
  cssVars: Record<string, string>;
};

export function getEventTheme(
  event?: { metadata?: Record<string, unknown> | null } | null
): EventTheme {
  const m = (event?.metadata || {}) as Record<string, unknown>;
  const primary = normalizeHexColor(m.primaryColor, DEFAULT_PRIMARY);
  const secondary = normalizeHexColor(m.secondaryColor, DEFAULT_SECONDARY);
  const primaryDark = shadeHex(primary, -0.18);
  const primaryLight = shadeHex(primary, 0.35);

  return {
    primary,
    secondary,
    primaryDark,
    primaryLight,
    pageBg: DEFAULT_PAGE_BG,
    border: DEFAULT_BORDER,
    text: DEFAULT_TEXT,
    cssVars: {
      // Drive existing .btn-gold / .gold-gradient via inherited CSS vars
      "--gold": primary,
      "--gold-dark": primaryDark,
      "--gold-light": primaryLight,
      "--text-muted": secondary,
      "--border": DEFAULT_BORDER,
      "--event-primary": primary,
      "--event-secondary": secondary,
      background: DEFAULT_PAGE_BG,
      color: DEFAULT_TEXT,
    },
  };
}

export function readThemeFromMetadata(
  metadata?: Record<string, unknown> | null
): { primaryColor: string; secondaryColor: string } {
  const m = metadata || {};
  return {
    primaryColor:
      typeof m.primaryColor === "string" && /^#/.test(m.primaryColor)
        ? m.primaryColor
        : "",
    secondaryColor:
      typeof m.secondaryColor === "string" && /^#/.test(m.secondaryColor)
        ? m.secondaryColor
        : "",
  };
}

/** Merge colour fields into metadata; empty string removes override (back to default). */
export function mergeThemeMetadata(
  existing: Record<string, unknown> | null | undefined,
  primaryColor: string,
  secondaryColor: string
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing || {}) };
  const p = primaryColor.trim();
  const s = secondaryColor.trim();
  if (p && /^#[0-9A-Fa-f]{3,6}$/.test(p)) {
    next.primaryColor = normalizeHexColor(p, DEFAULT_PRIMARY);
  } else {
    delete next.primaryColor;
  }
  if (s && /^#[0-9A-Fa-f]{3,6}$/.test(s)) {
    next.secondaryColor = normalizeHexColor(s, DEFAULT_SECONDARY);
  } else {
    delete next.secondaryColor;
  }
  return next;
}
