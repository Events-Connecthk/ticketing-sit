/**
 * Optional per-event full theme for the public ticketing page.
 * Stored in event.metadata:
 *   primaryColor, secondaryColor, backgroundColor, surfaceColor
 * Missing or invalid → current white-gold defaults (no visual change).
 *
 * Body/heading text stays dark for readability (not free-picked).
 */

export const DEFAULT_PRIMARY = "#C5A26E";
export const DEFAULT_SECONDARY = "#6B5E50";
export const DEFAULT_PAGE_BG = "#FAF8F5";
export const DEFAULT_SURFACE = "#FFFFFF";
export const DEFAULT_BORDER = "#EDE4D3";
export const DEFAULT_TEXT = "#2C2520";
export const DEFAULT_TEXT_BODY = "#3A2F23";

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
  surface: string;
  border: string;
  text: string;
  textBody: string;
  cssVars: Record<string, string>;
};

export function getEventTheme(
  event?: { metadata?: Record<string, unknown> | null } | null
): EventTheme {
  const m = (event?.metadata || {}) as Record<string, unknown>;
  const primary = normalizeHexColor(m.primaryColor, DEFAULT_PRIMARY);
  const secondary = normalizeHexColor(m.secondaryColor, DEFAULT_SECONDARY);
  const pageBg = normalizeHexColor(m.backgroundColor, DEFAULT_PAGE_BG);
  const surface = normalizeHexColor(m.surfaceColor, DEFAULT_SURFACE);
  const primaryDark = shadeHex(primary, -0.18);
  const primaryLight = shadeHex(primary, 0.35);
  // Soft border: slight blend of secondary into page bg (or fixed default)
  const border =
    m.backgroundColor || m.surfaceColor
      ? shadeHex(pageBg, -0.08)
      : DEFAULT_BORDER;

  return {
    primary,
    secondary,
    primaryDark,
    primaryLight,
    pageBg,
    surface,
    border,
    text: DEFAULT_TEXT,
    textBody: DEFAULT_TEXT_BODY,
    cssVars: {
      "--gold": primary,
      "--gold-dark": primaryDark,
      "--gold-light": primaryLight,
      "--text-muted": secondary,
      "--border": border,
      "--bg": pageBg,
      "--surface": surface,
      "--event-primary": primary,
      "--event-secondary": secondary,
      "--event-bg": pageBg,
      "--event-surface": surface,
      "--event-text": DEFAULT_TEXT,
      "--event-text-body": DEFAULT_TEXT_BODY,
      background: pageBg,
      color: DEFAULT_TEXT,
    },
  };
}

export type ThemeFormFields = {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
};

export function readThemeFromMetadata(
  metadata?: Record<string, unknown> | null
): ThemeFormFields {
  const m = metadata || {};
  const pick = (key: string) =>
    typeof m[key] === "string" && /^#/.test(String(m[key]))
      ? String(m[key])
      : "";
  return {
    primaryColor: pick("primaryColor"),
    secondaryColor: pick("secondaryColor"),
    backgroundColor: pick("backgroundColor"),
    surfaceColor: pick("surfaceColor"),
  };
}

function applyColorField(
  next: Record<string, unknown>,
  key: string,
  value: string,
  fallback: string
) {
  const v = value.trim();
  if (v && /^#[0-9A-Fa-f]{3,6}$/.test(v)) {
    next[key] = normalizeHexColor(v, fallback);
  } else {
    delete next[key];
  }
}

/** Merge theme fields into metadata; empty string removes override. */
export function mergeThemeMetadata(
  existing: Record<string, unknown> | null | undefined,
  fields: ThemeFormFields
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing || {}) };
  applyColorField(next, "primaryColor", fields.primaryColor, DEFAULT_PRIMARY);
  applyColorField(
    next,
    "secondaryColor",
    fields.secondaryColor,
    DEFAULT_SECONDARY
  );
  applyColorField(
    next,
    "backgroundColor",
    fields.backgroundColor,
    DEFAULT_PAGE_BG
  );
  applyColorField(next, "surfaceColor", fields.surfaceColor, DEFAULT_SURFACE);
  return next;
}
