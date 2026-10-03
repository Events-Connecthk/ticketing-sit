/**
 * Shared check-in / redeem logic for admin scanner and /check-in staff.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getAllPurchases, savePurchase } from "@/lib/db/purchases";
import {
  findTicketUnit,
  listSerials,
  purchaseMatchesRef,
} from "@/lib/tickets/serials";
import {
  normalizeScanRef,
  orderRefFromSerial,
} from "@/lib/tickets/scan-ref";
import {
  formatTicketDateWindow,
  isTicketValidOnDate,
} from "@/lib/tickets/validity";
import { hkTodayYmd } from "@/lib/time/hk";
import { loadEventBySlug } from "@/lib/config/events";
import {
  hasRedemptionOnDay,
  makeCheckInRecord,
  redemptionCount,
  type CheckInRecord,
} from "@/lib/tickets/redemption";
import type { PurchaseRecord } from "@/types";

export type CheckInActor = {
  byId?: string;
  byName: string;
};

export type CheckInResult = {
  ok: boolean;
  message: string;
  tone: "ok" | "error" | "warn" | "info";
  purchase?: PurchaseRecord | null;
  serial?: string;
  ticketTypeName?: string;
  phone?: string;
  checkedInAt?: string;
  checkedInBy?: string;
  remark?: string;
  used?: number;
  max?: number;
};

async function loadPurchasesForCheckin(): Promise<PurchaseRecord[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("purchases")
      .select("*")
      .order("bought_at", { ascending: false })
      .limit(2000);
    if (!error && data) return data as PurchaseRecord[];
  }
  return getAllPurchases();
}

async function savePurchaseForCheckin(
  record: PurchaseRecord
): Promise<PurchaseRecord | null> {
  const sb = getSupabaseAdmin();
  if (sb && record.id != null) {
    const updateData: Record<string, unknown> = {
      ticket_breakdown: record.ticket_breakdown,
      redeemed_at: record.redeemed_at,
      redemptions: record.redemptions,
    };
    let { data, error } = await sb
      .from("purchases")
      .update(updateData)
      .eq("id", record.id)
      .select()
      .single();
    if (error && (error.message || "").includes("redemptions")) {
      const { redemptions: _r, ...without } = updateData;
      const retry = await sb
        .from("purchases")
        .update(without)
        .eq("id", record.id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.error("[CheckIn] save:", error);
      return null;
    }
    return data as PurchaseRecord;
  }
  return savePurchase(record as any);
}

async function ticketTypeName(
  eventSlug: string,
  ticketTypeId: string
): Promise<string> {
  const ev = await loadEventBySlug(eventSlug);
  return (
    ev?.ticketTypes?.find((t) => t.id === ticketTypeId)?.name ||
    ticketTypeId ||
    "Ticket"
  );
}

async function ticketTypeLimit(
  eventSlug: string,
  ticketTypeId: string
): Promise<number> {
  const ev = await loadEventBySlug(eventSlug);
  return (
    ev?.ticketTypes?.find((t) => t.id === ticketTypeId)?.redemptionLimit ?? 1
  );
}

async function findPurchaseForScan(
  scanned: string
): Promise<PurchaseRecord | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: byOrd } = await sb
      .from("purchases")
      .select("*")
      .eq("order_reference", scanned)
      .limit(1)
      .maybeSingle();
    if (byOrd) return byOrd as PurchaseRecord;

    const { data: byPay } = await sb
      .from("purchases")
      .select("*")
      .eq("payment_reference", scanned)
      .limit(1)
      .maybeSingle();
    if (byPay) return byPay as PurchaseRecord;

    // Unit serial KPY-xxxxx-01 → parent order (avoids missing tickets past the row cap)
    const parent = orderRefFromSerial(scanned);
    if (parent) {
      const { data: byParent } = await sb
        .from("purchases")
        .select("*")
        .eq("order_reference", parent)
        .limit(1)
        .maybeSingle();
      if (byParent && purchaseMatchesRef(byParent as PurchaseRecord, scanned)) {
        return byParent as PurchaseRecord;
      }
    }
  }

  const all = await loadPurchasesForCheckin();
  return all.find((p) => purchaseMatchesRef(p, scanned)) || null;
}

export async function performCheckIn(
  ref: string,
  actor: CheckInActor,
  remark?: string,
  expectedEventSlug?: string
): Promise<CheckInResult> {
  const scanned = normalizeScanRef(ref || "");
  if (!scanned) {
    return { ok: false, message: "Enter a ticket code.", tone: "error" };
  }

  const found = await findPurchaseForScan(scanned);
  if (!found) {
    return {
      ok: false,
      message: "Invalid ticket - not found.",
      tone: "error",
    };
  }

  const expected = (expectedEventSlug || "").trim().toLowerCase();
  if (expected && (found.event_slug || "").toLowerCase() !== expected) {
    return {
      ok: false,
      message: `Wrong event. This ticket is for "${found.event_slug}", but you are checking in "${expected}".`,
      tone: "error",
      purchase: found,
      phone: found.phone,
    };
  }

  const checkIn = makeCheckInRecord({
    byId: actor.byId,
    byName: actor.byName,
    remark,
  });

  let unit = findTicketUnit(found, scanned);
  const serials = listSerials(found);

  if (!unit && serials.length > 1 && scanned === found.order_reference) {
    return {
      ok: false,
      message: `Multi-ticket order. Scan a ticket QR (e.g. ${serials[0]}), not only the order ref.`,
      tone: "warn",
      purchase: found,
      phone: found.phone,
    };
  }

  const breakdown = found.ticket_breakdown || [];
  if (!unit && breakdown.length === 1) {
    const only = breakdown[0] as any;
    if (only?.serial) {
      unit = {
        ticketTypeId: only.ticketTypeId,
        quantity: 1,
        serial: only.serial,
        redemptions: only.redemptions || [],
      };
    }
  }

  if (unit?.serial) {
    const max = await ticketTypeLimit(found.event_slug, unit.ticketTypeId);
    const count = redemptionCount(unit.redemptions as any);
    const ev = await loadEventBySlug(found.event_slug);
    const tt = ev?.ticketTypes?.find((t) => t.id === unit!.ticketTypeId);
    const todayHk = hkTodayYmd();
    const dateCheck = isTicketValidOnDate(tt || {}, todayHk);
    const window = formatTicketDateWindow(tt || {});

    if (count >= max) {
      return {
        ok: false,
        message: `Already fully checked in (${count}/${max}). Serial ${unit.serial}.`,
        tone: "error",
        purchase: found,
        serial: unit.serial,
        phone: found.phone,
        used: count,
        max,
      };
    }
    // Multi-day tickets: still max 1 scan per Hong Kong calendar day
    if (hasRedemptionOnDay(unit.redemptions as any, todayHk)) {
      return {
        ok: false,
        message: `Already checked in today (${todayHk} HK). Max 1 scan per day for this ticket. Serial ${unit.serial}.`,
        tone: "error",
        purchase: found,
        serial: unit.serial,
        phone: found.phone,
        used: count,
        max,
      };
    }
    if (!dateCheck.ok) {
      return {
        ok: false,
        message: `Cannot check in today. ${dateCheck.reason}. Allowed: ${window}.`,
        tone: "error",
        purchase: found,
        serial: unit.serial,
        phone: found.phone,
      };
    }

    const nextBreakdown = (found.ticket_breakdown || []).map((t: any) => {
      if (t.serial !== unit!.serial) return t;
      return {
        ...t,
        redemptions: [...(t.redemptions || []), checkIn],
      };
    });

    const updated: PurchaseRecord = {
      ...found,
      ticket_breakdown: nextBreakdown,
      redeemed_at: checkIn.at,
      redemptions: [...((found.redemptions as any[]) || []), checkIn] as any,
    };

    const saved = await savePurchaseForCheckin(updated);
    if (!saved) {
      return {
        ok: false,
        message: "Could not save check-in. Check database connection.",
        tone: "error",
        purchase: updated,
      };
    }

    const typeName = await ticketTypeName(found.event_slug, unit.ticketTypeId);
    return {
      ok: true,
      message: `Checked in ${unit.serial}`,
      tone: "ok",
      purchase: saved,
      serial: unit.serial,
      ticketTypeName: typeName,
      phone: found.phone,
      checkedInAt: checkIn.at,
      checkedInBy: checkIn.byName,
      remark: checkIn.remark,
      used: count + 1,
      max,
    };
  }

  // Legacy order without serials
  const units = found.ticket_breakdown || [];
  let max = 1;
  for (const sel of units) {
    const lim = await ticketTypeLimit(found.event_slug, sel.ticketTypeId);
    max = Math.max(max, lim);
  }
  const currentCount = redemptionCount(found.redemptions as any);
  const todayHkLegacy = hkTodayYmd();
  if (currentCount >= max) {
    return {
      ok: false,
      message: `Already fully checked in (${currentCount}/${max}).`,
      tone: "error",
      purchase: found,
      phone: found.phone,
    };
  }
  if (hasRedemptionOnDay(found.redemptions as any, todayHkLegacy)) {
    return {
      ok: false,
      message: `Already checked in today (${todayHkLegacy} HK). Max 1 scan per day.`,
      tone: "error",
      purchase: found,
      phone: found.phone,
      used: currentCount,
      max,
    };
  }

  const newRedemptions = [
    ...((found.redemptions as any[]) || []),
    checkIn,
  ];
  const updated: PurchaseRecord = {
    ...found,
    redemptions: newRedemptions as any,
    redeemed_at: checkIn.at,
  };
  const saved = await savePurchaseForCheckin(updated);
  if (!saved) {
    return {
      ok: false,
      message: "Could not save check-in. Check database connection.",
      tone: "error",
    };
  }
  return {
    ok: true,
    message: `Checked in (${newRedemptions.length}/${max})`,
    tone: "ok",
    purchase: saved,
    phone: found.phone,
    checkedInAt: checkIn.at,
    checkedInBy: checkIn.byName,
    remark: checkIn.remark,
    used: newRedemptions.length,
    max,
  };
}

export type AttendanceFlatRow = {
  key: string;
  redeemedAt: string;
  ticketId: string;
  ticketTypeLabel: string;
  name: string;
  email: string;
  phone: string;
  event: string;
  orderRef: string;
  checkedInBy: string;
  remark: string;
};

export async function countCheckedIn(eventSlug?: string): Promise<{
  checkedInTickets: number;
  totalTickets: number;
}> {
  const all = await loadPurchasesForCheckin();
  const rows = eventSlug
    ? all.filter((p) => p.event_slug === eventSlug)
    : all;

  let checkedInTickets = 0;
  let totalTickets = 0;

  for (const p of rows) {
    const units = p.ticket_breakdown || [];
    const hasSerials = units.some((u: any) => u.serial);
    if (hasSerials) {
      for (const u of units as any[]) {
        totalTickets += 1;
        if (redemptionCount(u.redemptions) > 0) checkedInTickets += 1;
      }
    } else {
      const n = Math.max(
        1,
        Number(p.number_of_tickets) ||
          units.reduce((s: number, u: any) => s + (u.quantity || 1), 0) ||
          1
      );
      totalTickets += n;
      if (redemptionCount(p.redemptions as any) > 0 || p.redeemed_at) {
        checkedInTickets += Math.min(
          n,
          Math.max(1, redemptionCount(p.redemptions as any) || 1)
        );
      }
    }
  }

  return { checkedInTickets, totalTickets };
}

export type CheckinEventOption = {
  slug: string;
  name: string;
  enabled: boolean;
};

/** Events available for the check-in event picker (staff + admin). */
export async function listCheckinEventOptions(): Promise<CheckinEventOption[]> {
  try {
    const sb = getSupabaseAdmin();
    if (sb) {
      const { data, error } = await sb
        .from("events")
        .select("slug, name, enabled")
        .order("name", { ascending: true });
      if (!error && data) {
        return data.map((e: any) => ({
          slug: String(e.slug),
          name: String(e.name || e.slug),
          enabled: e.enabled !== false,
        }));
      }
    }
    const { getAllEvents } = await import("@/lib/db/events");
    const events = await getAllEvents();
    return (events || [])
      .map((e) => ({
        slug: e.slug,
        name: e.name || e.slug,
        enabled: e.enabled !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error("[CheckIn] listCheckinEventOptions:", err);
    return [];
  }
}

export async function listRecentCheckIns(
  limit = 40,
  eventSlug?: string
): Promise<AttendanceFlatRow[]> {
  const all = await loadPurchasesForCheckin();
  const filtered = eventSlug
    ? all.filter((p) => p.event_slug === eventSlug)
    : all;
  const rows: AttendanceFlatRow[] = [];
  const typeNameCache = new Map<string, string>();

  async function typeLabel(eventSlugInner: string, typeId: string) {
    const k = `${eventSlugInner}:${typeId}`;
    if (typeNameCache.has(k)) return typeNameCache.get(k)!;
    const n = await ticketTypeName(eventSlugInner, typeId);
    typeNameCache.set(k, n);
    return n;
  }

  for (const p of filtered) {
    const units = p.ticket_breakdown || [];
    const hasSerials = units.some((u: any) => u.serial);
    if (hasSerials) {
      for (const u of units as any[]) {
        const reds = u.redemptions || [];
        if (!reds.length) continue;
        const last = reds[reds.length - 1];
        const at =
          typeof last === "string" ? last : (last as CheckInRecord)?.at || "";
        if (!at) continue;
        const typeName = await typeLabel(p.event_slug, u.ticketTypeId);
        rows.push({
          key: `${p.id}-${u.serial}-${at}`,
          redeemedAt: at,
          ticketId: u.serial,
          ticketTypeLabel: typeName,
          name: p.name,
          email: p.email,
          phone: p.phone,
          event: p.event_slug,
          orderRef: p.order_reference || p.payment_reference || "",
          checkedInBy:
            typeof last === "object" && last
              ? (last as CheckInRecord).byName || ""
              : "",
          remark:
            typeof last === "object" && last
              ? (last as CheckInRecord).remark || ""
              : "",
        });
      }
    } else if (redemptionCount(p.redemptions as any) > 0 || p.redeemed_at) {
      const reds = (p.redemptions as any[]) || [];
      const last =
        reds[reds.length - 1] ||
        (p.redeemed_at ? p.redeemed_at : null);
      if (!last) continue;
      const at = typeof last === "string" ? last : last.at;
      rows.push({
        key: String(p.id ?? p.order_reference),
        redeemedAt: at,
        ticketId: p.order_reference || "-",
        ticketTypeLabel: "Order",
        name: p.name,
        email: p.email,
        phone: p.phone,
        event: p.event_slug,
        orderRef: p.order_reference || p.payment_reference || "",
        checkedInBy:
          typeof last === "object" && last ? last.byName || "" : "",
        remark:
          typeof last === "object" && last ? last.remark || "" : "",
      });
    }
  }

  rows.sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));
  return rows.slice(0, limit);
}
