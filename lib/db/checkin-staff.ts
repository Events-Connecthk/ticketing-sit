/**
 * Check-in staff accounts (username + password). Admin creates; staff use /check-in only.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  hashCheckinPassword,
  verifyCheckinPassword,
} from "@/lib/security/checkin-session";

export type CheckinStaff = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  enabled: boolean;
  created_at?: string;
};

export type CheckinStaffPublic = Omit<CheckinStaff, "password_hash">;

const memoryStaff = new Map<string, CheckinStaff>();

function toPublic(s: CheckinStaff): CheckinStaffPublic {
  const { password_hash: _p, ...rest } = s;
  return rest;
}

function newId(): string {
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listCheckinStaff(): Promise<CheckinStaffPublic[]> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return Array.from(memoryStaff.values())
      .map(toPublic)
      .sort((a, b) => a.username.localeCompare(b.username));
  }
  const { data, error } = await sb
    .from("checkin_staff")
    .select("id, username, display_name, enabled, created_at")
    .order("username", { ascending: true });
  if (error) {
    console.error("[CheckinStaff] list:", error.message);
    return Array.from(memoryStaff.values()).map(toPublic);
  }
  return (data || []) as CheckinStaffPublic[];
}

export async function createCheckinStaff(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ ok: true; staff: CheckinStaffPublic } | { ok: false; error: string }> {
  const username = input.username.trim().toLowerCase().replace(/\s+/g, "");
  const displayName = input.displayName.trim() || username;
  const password = input.password;
  if (!username || username.length < 3) {
    return { ok: false, error: "Username must be at least 3 characters." };
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return {
      ok: false,
      error: "Username: letters, numbers, . _ - only.",
    };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const row: CheckinStaff = {
    id: newId(),
    username,
    display_name: displayName.slice(0, 80),
    password_hash: hashCheckinPassword(password),
    enabled: true,
    created_at: new Date().toISOString(),
  };

  const sb = getSupabaseAdmin();
  if (!sb) {
    if ([...memoryStaff.values()].some((s) => s.username === username)) {
      return { ok: false, error: "Username already exists." };
    }
    memoryStaff.set(row.id, row);
    return { ok: true, staff: toPublic(row) };
  }

  const { data, error } = await sb
    .from("checkin_staff")
    .insert({
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      password_hash: row.password_hash,
      enabled: true,
    })
    .select("id, username, display_name, enabled, created_at")
    .single();

  if (error) {
    console.error("[CheckinStaff] create:", error.message);
    if (error.message?.includes("duplicate") || error.code === "23505") {
      return { ok: false, error: "Username already exists." };
    }
    if (error.message?.includes("checkin_staff") || error.code === "42P01") {
      return {
        ok: false,
        error:
          "Table checkin_staff missing. Run supabase-schema.sql (check-in staff section) in Supabase.",
      };
    }
    return { ok: false, error: error.message || "Create failed." };
  }
  return { ok: true, staff: data as CheckinStaffPublic };
}

export async function setCheckinStaffEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const s = memoryStaff.get(id);
    if (!s) return false;
    s.enabled = enabled;
    return true;
  }
  const { error } = await sb
    .from("checkin_staff")
    .update({ enabled })
    .eq("id", id);
  if (error) {
    console.error("[CheckinStaff] setEnabled:", error.message);
    return false;
  }
  return true;
}

export async function deleteCheckinStaff(id: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return memoryStaff.delete(id);
  }
  const { error } = await sb.from("checkin_staff").delete().eq("id", id);
  if (error) {
    console.error("[CheckinStaff] delete:", error.message);
    return false;
  }
  return true;
}

export async function resetCheckinStaffPassword(
  id: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const hash = hashCheckinPassword(newPassword);
  const sb = getSupabaseAdmin();
  if (!sb) {
    const s = memoryStaff.get(id);
    if (!s) return { ok: false, error: "Not found." };
    s.password_hash = hash;
    return { ok: true };
  }
  const { error } = await sb
    .from("checkin_staff")
    .update({ password_hash: hash })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function authenticateCheckinStaff(
  username: string,
  password: string
): Promise<CheckinStaffPublic | null> {
  const u = username.trim().toLowerCase();
  if (!u || !password) return null;

  const sb = getSupabaseAdmin();
  if (!sb) {
    const s = [...memoryStaff.values()].find((x) => x.username === u);
    if (!s || !s.enabled) return null;
    if (!verifyCheckinPassword(password, s.password_hash)) return null;
    return toPublic(s);
  }

  const { data, error } = await sb
    .from("checkin_staff")
    .select("id, username, display_name, password_hash, enabled, created_at")
    .eq("username", u)
    .maybeSingle();

  if (error || !data) return null;
  if (data.enabled === false) return null;
  if (!verifyCheckinPassword(password, data.password_hash)) return null;
  return {
    id: data.id,
    username: data.username,
    display_name: data.display_name,
    enabled: data.enabled !== false,
    created_at: data.created_at,
  };
}
