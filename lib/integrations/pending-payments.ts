/**
 * Carts awaiting KPay confirmation (redirect + webhook).
 *
 * Storage priority:
 * 1) Supabase `pending_kpay_payments` via service role (required on Vercel serverless)
 * 2) In-memory + .data/ file (local dev only; not shared across Vercel instances)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { OrderCart } from "@/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export interface PendingPayment {
  outTradeNo: string;
  cart: OrderCart;
  createdAt: number;
  paymentUrl?: string;
  managedOrderNo?: string;
  status: "pending" | "paid" | "failed";
}

const store = new Map<string, PendingPayment>();
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const TABLE = "pending_kpay_payments";
const useLocalDisk =
  !process.env.VERCEL && process.env.NODE_ENV !== "production";

let hydrated = false;
let supabaseTableMissing = false;

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

function localPaths() {
  const dir = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
  return { dir, file: path.join(dir, "pending-kpay.json") };
}

function persistLocal() {
  if (!useLocalDisk) return;
  try {
    const { dir, file } = localPaths();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj: Record<string, PendingPayment> = {};
    for (const [k, v] of store.entries()) obj[k] = v;
    writeFileSync(file, JSON.stringify(obj), "utf8");
  } catch (err) {
    console.warn("[PendingPayments] local persist failed:", err);
  }
}

function hydrateLocal() {
  if (hydrated) return;
  hydrated = true;
  if (!useLocalDisk) return;
  try {
    const { file } = localPaths();
    if (!existsSync(file)) return;
    const raw = readFileSync(file, "utf8");
    const obj = JSON.parse(raw) as Record<string, PendingPayment>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj || {})) {
      if (!v?.outTradeNo || !v?.cart) continue;
      if (now - (v.createdAt || 0) > TTL_MS) continue;
      store.set(k, v);
    }
  } catch {
    // ignore
  }
}

function rowToPending(row: any): PendingPayment | null {
  if (!row?.out_trade_no || !row?.cart) return null;
  return {
    outTradeNo: String(row.out_trade_no),
    cart: row.cart as OrderCart,
    createdAt: row.created_at
      ? new Date(row.created_at).getTime()
      : Date.now(),
    paymentUrl: row.payment_url || undefined,
    managedOrderNo: row.managed_order_no || undefined,
    status: (row.status as PendingPayment["status"]) || "pending",
  };
}

async function dbSave(record: PendingPayment): Promise<boolean> {
  if (supabaseTableMissing) return false;
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { error } = await admin.from(TABLE).upsert(
      {
        out_trade_no: record.outTradeNo,
        cart: record.cart,
        status: record.status,
        payment_url: record.paymentUrl || null,
        managed_order_no: record.managedOrderNo || null,
        created_at: new Date(record.createdAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "out_trade_no" }
    );
    if (error) {
      // Table missing → fall back without spamming forever
      if (
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.code === "PGRST205"
      ) {
        supabaseTableMissing = true;
        console.warn(
          "[PendingPayments] Table pending_kpay_payments missing — run supabase-schema.sql. Using memory/local only."
        );
      } else {
        console.error("[PendingPayments] Supabase upsert failed:", error.message);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error("[PendingPayments] Supabase upsert error:", err);
    return false;
  }
}

async function dbGet(outTradeNo: string): Promise<PendingPayment | null> {
  if (supabaseTableMissing) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("*")
      .eq("out_trade_no", outTradeNo)
      .maybeSingle();
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.code === "PGRST205"
      ) {
        supabaseTableMissing = true;
      }
      return null;
    }
    const rec = rowToPending(data);
    if (rec && Date.now() - rec.createdAt > TTL_MS) {
      await dbDelete(outTradeNo);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

async function dbUpdateStatus(
  outTradeNo: string,
  status: PendingPayment["status"]
): Promise<boolean> {
  if (supabaseTableMissing) return false;
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { error } = await admin
      .from(TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("out_trade_no", outTradeNo);
    return !error;
  } catch {
    return false;
  }
}

async function dbDelete(outTradeNo: string): Promise<void> {
  if (supabaseTableMissing) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    await admin.from(TABLE).delete().eq("out_trade_no", outTradeNo);
  } catch {
    // ignore
  }
}

export async function savePendingPayment(
  outTradeNo: string,
  cart: OrderCart,
  extra?: Partial<PendingPayment>
): Promise<PendingPayment> {
  hydrateLocal();
  purgeExpired();
  const record: PendingPayment = {
    outTradeNo,
    cart,
    createdAt: Date.now(),
    status: "pending",
    ...extra,
  };
  store.set(outTradeNo, record);
  persistLocal();
  const ok = await dbSave(record);
  if (!ok && process.env.VERCEL) {
    console.warn(
      "[PendingPayments] Durable save failed on Vercel — webhook may not find cart. Ensure SUPABASE_SERVICE_ROLE_KEY + pending_kpay_payments table."
    );
  }
  return record;
}

export async function getPendingPayment(
  outTradeNo: string
): Promise<PendingPayment | null> {
  hydrateLocal();
  purgeExpired();
  const fromDb = await dbGet(outTradeNo);
  if (fromDb) {
    store.set(outTradeNo, fromDb);
    return fromDb;
  }
  return store.get(outTradeNo) || null;
}

export async function markPendingPaid(
  outTradeNo: string
): Promise<PendingPayment | null> {
  hydrateLocal();
  let rec = store.get(outTradeNo) || (await dbGet(outTradeNo));
  if (!rec) return null;
  rec = { ...rec, status: "paid" };
  store.set(outTradeNo, rec);
  persistLocal();
  await dbUpdateStatus(outTradeNo, "paid");
  return rec;
}

export async function deletePendingPayment(outTradeNo: string): Promise<void> {
  hydrateLocal();
  store.delete(outTradeNo);
  persistLocal();
  await dbDelete(outTradeNo);
}
