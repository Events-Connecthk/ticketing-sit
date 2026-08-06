/**
 * Ticket design model (visual editor).
 * Stored on event.metadata.ticketDesign.
 * When status === "published", PDF uses this layout; otherwise legacy generator.
 */

export type TicketPreset = "A4" | "A5" | "A6" | "Letter" | "Custom";
export type TicketOrientation = "portrait" | "landscape";
export type TicketUnit = "mm" | "cm" | "in" | "px";
export type BgFit = "cover" | "contain" | "stretch" | "original";
export type DesignStatus = "draft" | "published";

export type DynamicFieldKey =
  | "attendee.fullName"
  | "attendee.firstName"
  | "attendee.lastName"
  | "attendee.email"
  | "attendee.phone"
  | "attendee.company"
  | "event.name"
  | "event.date"
  | "event.startTime"
  | "event.endTime"
  | "event.venue"
  | "event.address"
  | "ticket.type"
  | "ticket.number"
  | "ticket.price"
  | "order.number"
  | "order.purchaseDate"
  | "order.purchaserName"
  | "order.purchaserEmail";

export type DesignElementType =
  | "text"
  | "field"
  | "image"
  | "qr"
  | "barcode"
  | "rect"
  | "line";

export type DesignElement = {
  id: string;
  type: DesignElementType;
  x: number; // mm from left
  y: number; // mm from top
  width: number; // mm
  height: number; // mm
  rotation: number;
  locked: boolean;
  zIndex: number;
  // text / field
  content?: string;
  fieldKey?: DynamicFieldKey;
  label?: string;
  showLabel?: boolean;
  fontFamily?: string;
  fontSize?: number; // pt
  fontWeight?: "normal" | "bold";
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  maxLines?: number;
  emptyMode?: "hide" | "blank" | "fallback";
  fallback?: string;
  dateFormat?: string;
  // image
  imageUrl?: string;
  // qr / barcode
  qrFg?: string;
  qrBg?: string;
  showCodeText?: boolean;
  // shape
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

export type TicketDesign = {
  version: 1;
  name: string;
  status: DesignStatus;
  canvas: {
    preset: TicketPreset;
    orientation: TicketOrientation;
    widthMm: number;
    heightMm: number;
  };
  background: {
    color: string;
    imageUrl?: string;
    fit: BgFit;
    positionX: number; // 0-100
    positionY: number;
    opacity: number; // 0-1
  };
  elements: DesignElement[];
  updatedAt?: string;
};

/** ISO 216 + Letter in mm (portrait) */
export const PRESET_MM: Record<Exclude<TicketPreset, "Custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  Letter: { w: 215.9, h: 279.4 },
};

export const MM_TO_PT = 72 / 25.4;
export const PX_PER_MM_SCREEN = 3.2; // editor scale

export function uid(prefix = "el"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultTicketDesign(name = "Default ticket"): TicketDesign {
  const { w, h } = PRESET_MM.A5;
  return {
    version: 1,
    name,
    status: "draft",
    canvas: {
      preset: "A5",
      orientation: "portrait",
      widthMm: w,
      heightMm: h,
    },
    background: {
      color: "#FFFFFF",
      fit: "cover",
      positionX: 50,
      positionY: 50,
      opacity: 1,
    },
    elements: [
      {
        id: uid("t"),
        type: "field",
        fieldKey: "event.name",
        x: 10,
        y: 12,
        width: 128,
        height: 12,
        rotation: 0,
        locked: false,
        zIndex: 1,
        fontSize: 16,
        fontWeight: "bold",
        color: "#2C2520",
        align: "center",
        emptyMode: "blank",
      },
      {
        id: uid("t"),
        type: "field",
        fieldKey: "ticket.type",
        x: 10,
        y: 30,
        width: 128,
        height: 10,
        rotation: 0,
        locked: false,
        zIndex: 2,
        fontSize: 13,
        fontWeight: "bold",
        color: "#2C2520",
        align: "center",
        emptyMode: "blank",
      },
      {
        id: uid("t"),
        type: "field",
        fieldKey: "ticket.number",
        x: 10,
        y: 44,
        width: 128,
        height: 8,
        rotation: 0,
        locked: false,
        zIndex: 3,
        fontSize: 11,
        color: "#3A2F23",
        align: "center",
        emptyMode: "blank",
      },
      {
        id: uid("qr"),
        type: "qr",
        x: 44,
        y: 60,
        width: 60,
        height: 60,
        rotation: 0,
        locked: false,
        zIndex: 4,
        qrFg: "#000000",
        qrBg: "#FFFFFF",
        showCodeText: true,
      },
      {
        id: uid("t"),
        type: "field",
        fieldKey: "attendee.fullName",
        x: 10,
        y: 130,
        width: 128,
        height: 8,
        rotation: 0,
        locked: false,
        zIndex: 5,
        fontSize: 11,
        color: "#2C2520",
        align: "center",
        showLabel: true,
        label: "Name",
        emptyMode: "blank",
      },
      {
        id: uid("t"),
        type: "field",
        fieldKey: "order.purchaseDate",
        x: 10,
        y: 145,
        width: 128,
        height: 7,
        rotation: 0,
        locked: false,
        zIndex: 6,
        fontSize: 9,
        color: "#6B5E50",
        align: "center",
        dateFormat: "long",
        emptyMode: "blank",
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function applyPreset(
  design: TicketDesign,
  preset: TicketPreset,
  orientation: TicketOrientation
): TicketDesign {
  let w = design.canvas.widthMm;
  let h = design.canvas.heightMm;
  if (preset !== "Custom") {
    const base = PRESET_MM[preset];
    w = base.w;
    h = base.h;
  }
  if (orientation === "landscape" && w < h) {
    [w, h] = [h, w];
  }
  if (orientation === "portrait" && w > h && preset !== "Custom") {
    [w, h] = [h, w];
  }
  return {
    ...design,
    canvas: { ...design.canvas, preset, orientation, widthMm: w, heightMm: h },
    updatedAt: new Date().toISOString(),
  };
}

export function parseTicketDesign(raw: unknown): TicketDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as TicketDesign;
  if (d.version !== 1 || !d.canvas || !Array.isArray(d.elements)) return null;
  return d;
}

export function getPublishedDesign(
  event?: { metadata?: Record<string, unknown> | null } | null
): TicketDesign | null {
  const d = parseTicketDesign(event?.metadata?.ticketDesign);
  if (!d || d.status !== "published") return null;
  return d;
}

export function getTicketDesignFromEvent(
  event?: { metadata?: Record<string, unknown> | null } | null
): TicketDesign | null {
  return parseTicketDesign(event?.metadata?.ticketDesign);
}

export type TicketDataContext = {
  attendee: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company: string;
    custom?: Record<string, string>;
  };
  event: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    venue: string;
    address: string;
  };
  ticket: {
    type: string;
    number: string;
    price: string;
    seat: string;
    row: string;
    section: string;
  };
  order: {
    number: string;
    purchaseDate: string;
    purchaserName: string;
    purchaserEmail: string;
  };
};

export function sampleTicketData(): TicketDataContext {
  return {
    attendee: {
      fullName: "Alex Chen",
      firstName: "Alex",
      lastName: "Chen",
      email: "alex.chen@example.com",
      phone: "+852 9123 4567",
      company: "ConnectHK",
    },
    event: {
      name: "Sample Event Night",
      date: "2026-08-06",
      startTime: "19:00",
      endTime: "23:00",
      venue: "Victoria Peak",
      address: "Hong Kong",
    },
    ticket: {
      type: "General Admission",
      number: "KPY-48291-01",
      price: "HKD 350",
      seat: "12",
      row: "B",
      section: "Main",
    },
    order: {
      number: "KPY-48291",
      purchaseDate: new Date().toISOString(),
      purchaserName: "Alex Chen",
      purchaserEmail: "alex.chen@example.com",
    },
  };
}

function formatDateValue(isoOrYmd: string, fmt?: string): string {
  if (!isoOrYmd) return "";
  const d = new Date(
    isoOrYmd.includes("T") ? isoOrYmd : `${isoOrYmd}T12:00:00`
  );
  if (Number.isNaN(d.getTime())) return isoOrYmd;
  if (fmt === "short") {
    return d.toLocaleDateString("en-GB", {
      timeZone: "Asia/Hong_Kong",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  if (fmt === "us") {
    return d.toLocaleDateString("en-US", {
      timeZone: "Asia/Hong_Kong",
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });
  }
  // long default
  return d.toLocaleDateString("en-US", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeValue(t: string, fmt?: string): string {
  if (!t) return "";
  // already HH:mm or range
  if (fmt === "12h" && /^\d{1,2}:\d{2}/.test(t)) {
    const [hh, mm] = t.split(":");
    let h = parseInt(hh, 10);
    const am = h < 12;
    if (h === 0) h = 12;
    if (h > 12) h -= 12;
    return `${h}:${mm.slice(0, 2)} ${am ? "AM" : "PM"}`;
  }
  return t;
}

export function resolveFieldValue(
  key: DynamicFieldKey | string,
  data: TicketDataContext,
  opts?: { dateFormat?: string }
): string {
  const map: Record<string, string> = {
    "attendee.fullName": data.attendee.fullName,
    "attendee.firstName": data.attendee.firstName,
    "attendee.lastName": data.attendee.lastName,
    "attendee.email": data.attendee.email,
    "attendee.phone": data.attendee.phone,
    "attendee.company": data.attendee.company,
    "event.name": data.event.name,
    "event.date": formatDateValue(data.event.date, opts?.dateFormat || "long"),
    "event.startTime": formatTimeValue(data.event.startTime, opts?.dateFormat),
    "event.endTime": formatTimeValue(data.event.endTime, opts?.dateFormat),
    "event.venue": data.event.venue,
    "event.address": data.event.address,
    "ticket.type": data.ticket.type,
    "ticket.number": data.ticket.number,
    "ticket.price": data.ticket.price,
    "ticket.seat": data.ticket.seat,
    "ticket.row": data.ticket.row,
    "ticket.section": data.ticket.section,
    "order.number": data.order.number,
    "order.purchaseDate": formatDateValue(
      data.order.purchaseDate,
      opts?.dateFormat || "long"
    ),
    "order.purchaserName": data.order.purchaserName,
    "order.purchaserEmail": data.order.purchaserEmail,
  };
  if (key.startsWith("custom.") && data.attendee.custom) {
    return data.attendee.custom[key.slice(7)] || "";
  }
  return map[key] ?? "";
}

export function renderElementText(
  el: DesignElement,
  data: TicketDataContext
): string | null {
  if (el.type === "text") {
    return el.content || "";
  }
  if (el.type === "field" && el.fieldKey) {
    const val = resolveFieldValue(el.fieldKey, data, {
      dateFormat: el.dateFormat,
    });
    if (!val) {
      if (el.emptyMode === "hide") return null;
      if (el.emptyMode === "fallback") return el.fallback || "";
      return "";
    }
    if (el.showLabel && el.label) return `${el.label}: ${val}`;
    return val;
  }
  return "";
}

export const FIELD_CATALOG: Array<{
  key: DynamicFieldKey;
  label: string;
  group: string;
}> = [
  { key: "attendee.fullName", label: "Full name", group: "Attendee" },
  { key: "attendee.firstName", label: "First name", group: "Attendee" },
  { key: "attendee.lastName", label: "Last name", group: "Attendee" },
  { key: "attendee.email", label: "Email", group: "Attendee" },
  { key: "attendee.phone", label: "Phone", group: "Attendee" },
  { key: "attendee.company", label: "Company", group: "Attendee" },
  { key: "event.name", label: "Event name", group: "Event" },
  { key: "event.date", label: "Event date", group: "Event" },
  { key: "event.startTime", label: "Start time", group: "Event" },
  { key: "event.endTime", label: "End time", group: "Event" },
  { key: "event.venue", label: "Venue name", group: "Event" },
  { key: "event.address", label: "Venue address", group: "Event" },
  { key: "ticket.type", label: "Ticket type", group: "Ticket" },
  { key: "ticket.number", label: "Ticket number", group: "Ticket" },
  { key: "ticket.price", label: "Price", group: "Ticket" },
  { key: "order.number", label: "Order number", group: "Order" },
  { key: "order.purchaseDate", label: "Purchase date", group: "Order" },
  { key: "order.purchaserName", label: "Purchaser name", group: "Order" },
  { key: "order.purchaserEmail", label: "Purchaser email", group: "Order" },
];

export function clampElementsToCanvas(design: TicketDesign): TicketDesign {
  const { widthMm: W, heightMm: H } = design.canvas;
  return {
    ...design,
    elements: design.elements.map((el) => ({
      ...el,
      width: Math.min(el.width, W),
      height: Math.min(el.height, H),
      x: Math.max(0, Math.min(el.x, W - Math.min(el.width, W))),
      y: Math.max(0, Math.min(el.y, H - Math.min(el.height, H))),
    })),
  };
}

/** Rough check: image pixels vs print mm at 150 DPI */
export function warnLowResolution(
  imgW: number,
  imgH: number,
  ticketWmm: number,
  ticketHmm: number
): string | null {
  const needW = (ticketWmm / 25.4) * 150;
  const needH = (ticketHmm / 25.4) * 150;
  if (imgW < needW * 0.7 || imgH < needH * 0.7) {
    return `Image resolution may be low for this ticket size (got ${imgW}x${imgH}px; aim for ~${Math.round(needW)}x${Math.round(needH)}px at 150 DPI).`;
  }
  return null;
}
