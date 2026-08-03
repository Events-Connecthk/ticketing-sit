"use server";

import { authenticateCheckinStaff } from "@/lib/db/checkin-staff";
import {
  clearCheckinSession,
  createCheckinSession,
  getCheckinSession,
  requireCheckinStaff,
} from "@/lib/security/checkin-session";
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

// Admin staff management lives in @/app/sit-admin/actions (not re-exported).
