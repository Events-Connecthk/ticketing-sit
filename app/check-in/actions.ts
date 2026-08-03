"use server";

import {
  authenticateCheckinStaff,
  createCheckinStaff,
  deleteCheckinStaff,
  listCheckinStaff,
  resetCheckinStaffPassword,
  setCheckinStaffEnabled,
  type CheckinStaffPublic,
} from "@/lib/db/checkin-staff";
import {
  clearCheckinSession,
  createCheckinSession,
  getCheckinSession,
  requireCheckinStaff,
} from "@/lib/security/checkin-session";
import { requireAdmin } from "@/lib/security/admin-session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  countCheckedIn,
  listRecentCheckIns,
  performCheckIn,
  type CheckInResult,
  type AttendanceFlatRow,
} from "@/lib/tickets/checkin-service";

// ——— Staff app (check-in only) ———

export async function checkinLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string; displayName?: string }> {
  const rl = checkRateLimit("checkin-login", {
    limit: 12,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.ok) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }
  const staff = await authenticateCheckinStaff(username, password);
  if (!staff) {
    return { ok: false, error: "Invalid username or password." };
  }
  await createCheckinSession({
    id: staff.id,
    username: staff.username,
    displayName: staff.display_name,
  });
  return { ok: true, displayName: staff.display_name };
}

export async function checkinLogout(): Promise<void> {
  await clearCheckinSession();
}

export async function checkinSessionStatus(): Promise<{
  ok: boolean;
  displayName?: string;
  username?: string;
}> {
  const s = await getCheckinSession();
  if (!s) return { ok: false };
  return {
    ok: true,
    displayName: s.displayName,
    username: s.username,
  };
}

export async function checkinPerformRedeem(
  ref: string,
  remark?: string
): Promise<CheckInResult> {
  try {
    const staff = await requireCheckinStaff();
    return await performCheckIn(
      ref,
      { byId: staff.staffId, byName: staff.displayName },
      remark
    );
  } catch {
    return {
      ok: false,
      message: "Session expired. Sign in again.",
      tone: "error",
    };
  }
}

export async function checkinGetStats(eventSlug?: string): Promise<{
  checkedInTickets: number;
  totalTickets: number;
}> {
  try {
    await requireCheckinStaff();
    return await countCheckedIn(eventSlug || undefined);
  } catch {
    return { checkedInTickets: 0, totalTickets: 0 };
  }
}

export async function checkinListRecent(): Promise<AttendanceFlatRow[]> {
  try {
    await requireCheckinStaff();
    return await listRecentCheckIns(50);
  } catch {
    return [];
  }
}

// ——— Admin: manage staff accounts ———

export async function adminListCheckinStaff(): Promise<CheckinStaffPublic[]> {
  await requireAdmin();
  return listCheckinStaff();
}

export async function adminCreateCheckinStaff(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ ok: boolean; error?: string; staff?: CheckinStaffPublic }> {
  await requireAdmin();
  const res = await createCheckinStaff(input);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, staff: res.staff };
}

export async function adminSetCheckinStaffEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  await requireAdmin();
  return setCheckinStaffEnabled(id, enabled);
}

export async function adminDeleteCheckinStaff(id: string): Promise<boolean> {
  await requireAdmin();
  return deleteCheckinStaff(id);
}

export async function adminResetCheckinStaffPassword(
  id: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  return resetCheckinStaffPassword(id, newPassword);
}

/** Admin scanner also stores who = Admin */
export async function adminPerformCheckIn(
  ref: string,
  remark?: string
): Promise<CheckInResult> {
  try {
    await requireAdmin();
    return await performCheckIn(
      ref,
      { byId: "admin", byName: "Admin" },
      remark
    );
  } catch {
    return {
      ok: false,
      message: "Admin session expired. Sign in again.",
      tone: "error",
    };
  }
}
