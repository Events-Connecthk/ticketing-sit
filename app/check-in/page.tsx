"use client";

import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  checkinGetStats,
  checkinListRecent,
  checkinLogin,
  checkinLogout,
  checkinPerformRedeem,
  checkinSessionStatus,
} from "./actions";
import { formatHkDateTime, formatHkTime } from "@/lib/time/hk";
import type { AttendanceFlatRow } from "@/lib/tickets/checkin-service";
import { RefreshCw } from "lucide-react";

/**
 * Door staff only - no admin dashboard access.
 * Login with check-in account issued by admin.
 */
export default function CheckInPage() {
  const [authed, setAuthed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [scanRef, setScanRef] = useState("");
  const [remark, setRemark] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "error" | "warn" | "info">("info");
  const [lastResult, setLastResult] = useState<{
    serial?: string;
    ticketTypeName?: string;
    phone?: string;
    name?: string;
    checkedInAt?: string;
    checkedInBy?: string;
    remark?: string;
    used?: number;
    max?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ checkedInTickets: 0, totalTickets: 0 });
  const [recent, setRecent] = useState<AttendanceFlatRow[]>([]);
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastQrRef = useRef("");
  const scanBusyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await checkinSessionStatus();
      if (cancelled) return;
      if (s.ok) {
        setAuthed(true);
        setDisplayName(s.displayName || s.username || "Staff");
        await refreshData();
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData() {
    const [st, rec] = await Promise.all([
      checkinGetStats(),
      checkinListRecent(),
    ]);
    setStats(st);
    setRecent(rec);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await checkinLogin(username, password);
      if (!res.ok) {
        setLoginError(res.error || "Login failed");
        return;
      }
      setAuthed(true);
      setDisplayName(res.displayName || username);
      setPassword("");
      await refreshData();
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    stopCamera();
    await checkinLogout();
    setAuthed(false);
    setDisplayName("");
    setLastResult(null);
    setMessage("");
  }

  async function doCheckIn(code: string) {
    const ref = code.trim();
    if (!ref || busy || scanBusyRef.current) return;
    scanBusyRef.current = true;
    setBusy(true);
    setMessage("Checking in…");
    setTone("info");
    try {
      const res = await checkinPerformRedeem(ref, remark);
      setTone(res.tone);
      setMessage(res.message);
      if (res.ok) {
        setLastResult({
          serial: res.serial,
          ticketTypeName: res.ticketTypeName,
          phone: res.phone,
          name: res.purchase?.name,
          checkedInAt: res.checkedInAt,
          checkedInBy: res.checkedInBy,
          remark: res.remark,
          used: res.used,
          max: res.max,
        });
        setRemark("");
        setScanRef("");
        await refreshData();
      } else {
        setLastResult(
          res.purchase
            ? {
                serial: res.serial,
                phone: res.phone,
                name: res.purchase.name,
                ticketTypeName: res.ticketTypeName,
                used: res.used,
                max: res.max,
              }
            : null
        );
      }
    } finally {
      setBusy(false);
      setTimeout(() => {
        scanBusyRef.current = false;
      }, 800);
    }
  }

  function stopCamera() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const v = videoRef.current;
    if (v?.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    setCameraOn(false);
  }

  async function startCamera() {
    lastQrRef.current = "";
    scanBusyRef.current = false;
    setCameraOn(true);
    setMessage("Camera on - point at ticket QR");
    setTone("info");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA)
            return;
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, w, h);
          if (code?.data) {
            const raw = code.data.trim();
            if (raw && raw !== lastQrRef.current && !scanBusyRef.current) {
              lastQrRef.current = raw;
              setScanRef(raw);
              void doCheckIn(raw);
            }
          }
        }, 350);
      }
    } catch {
      setMessage("Could not open camera. Use manual entry.");
      setTone("error");
      setCameraOn(false);
    }
  }

  if (!authed) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-12 bg-zinc-950 text-white">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Check-in</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Staff door access only. Not the admin dashboard.
          </p>
          <form onSubmit={handleLogin} className="mt-8 space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              className="w-full rounded-xl border border-white/20 bg-zinc-900 px-4 py-3 text-white placeholder:text-zinc-500 outline-none focus:border-white"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/20 bg-zinc-900 px-4 py-3 text-white placeholder:text-zinc-500 outline-none focus:border-white"
            />
            {loginError && (
              <p className="text-sm text-red-400">{loginError}</p>
            )}
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loggingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const toneClass =
    tone === "ok"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "error"
        ? "bg-red-50 border-red-200 text-red-900"
        : tone === "warn"
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-zinc-50 border-zinc-200 text-zinc-800";

  return (
    <div className="min-h-screen bg-zinc-100 pb-16">
      <div className="border-b bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-lg">Check-in</h1>
            <p className="text-xs text-zinc-500">
              Signed in as <strong>{displayName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm px-3 py-2 border rounded-lg hover:bg-zinc-50"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs text-zinc-500 uppercase tracking-wide">
              Checked in
            </div>
            <div className="text-3xl font-semibold tabular-nums text-emerald-700 mt-1">
              {stats.checkedInTickets}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              tickets with at least one check-in
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs text-zinc-500 uppercase tracking-wide">
              Total tickets
            </div>
            <div className="text-3xl font-semibold tabular-nums text-zinc-800 mt-1">
              {stats.totalTickets}
            </div>
            <button
              type="button"
              onClick={() => refreshData()}
              className="mt-2 text-xs text-zinc-500 inline-flex items-center gap-1 hover:text-black"
            >
              <RefreshCw className="h-3 w-3" /> Refresh count
            </button>
          </div>
        </div>

        {/* Scanner */}
        <div className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <h2 className="font-semibold">Scan or enter code</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={scanRef}
              onChange={(e) => setScanRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void doCheckIn(scanRef);
                }
              }}
              placeholder="Ticket serial or order ref"
              className="flex-1 border rounded-xl px-3 py-2.5 text-sm font-mono"
            />
            <button
              type="button"
              disabled={busy || !scanRef.trim()}
              onClick={() => doCheckIn(scanRef)}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Working…" : "Check in"}
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500">
              Remarks (optional)
            </label>
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="e.g. VIP guest, wheelchair access, note for ops"
              maxLength={500}
              className="mt-1 w-full border rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {!cameraOn ? (
              <button
                type="button"
                onClick={startCamera}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50"
              >
                Start camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="rounded-lg border border-red-200 text-red-700 px-3 py-2 text-sm hover:bg-red-50"
              >
                Stop camera
              </button>
            )}
          </div>

          {cameraOn && (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] max-h-72">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}

          {message && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
              {message}
            </div>
          )}

          {lastResult && (
            <div className="rounded-xl border bg-zinc-50 p-4 text-sm space-y-1.5">
              <div className="font-semibold text-zinc-900">Last check-in</div>
              {lastResult.name && (
                <div>
                  <span className="text-zinc-500">Name: </span>
                  {lastResult.name}
                </div>
              )}
              {lastResult.ticketTypeName && (
                <div>
                  <span className="text-zinc-500">Ticket: </span>
                  {lastResult.ticketTypeName}
                </div>
              )}
              {lastResult.serial && (
                <div>
                  <span className="text-zinc-500">Serial: </span>
                  <span className="font-mono text-xs">{lastResult.serial}</span>
                </div>
              )}
              {lastResult.phone && (
                <div>
                  <span className="text-zinc-500">Phone: </span>
                  {lastResult.phone}
                </div>
              )}
              {lastResult.checkedInAt && (
                <div>
                  <span className="text-zinc-500">Time: </span>
                  {formatHkDateTime(lastResult.checkedInAt)} (
                  {formatHkTime(lastResult.checkedInAt)} HK)
                </div>
              )}
              {lastResult.checkedInBy && (
                <div>
                  <span className="text-zinc-500">By: </span>
                  {lastResult.checkedInBy}
                </div>
              )}
              {lastResult.remark && (
                <div>
                  <span className="text-zinc-500">Remark: </span>
                  {lastResult.remark}
                </div>
              )}
              {lastResult.used != null && lastResult.max != null && (
                <div className="text-xs text-zinc-500">
                  Uses: {lastResult.used}/{lastResult.max}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent */}
        <div className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <h2 className="font-semibold mb-3">Recent check-ins</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b">
                  <th className="pb-2 pr-2">Time</th>
                  <th className="pb-2 pr-2">Ticket</th>
                  <th className="pb-2 pr-2">Name / phone</th>
                  <th className="pb-2 pr-2">By</th>
                  <th className="pb-2">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-400">
                      No check-ins yet.
                    </td>
                  </tr>
                ) : (
                  recent.map((r) => (
                    <tr key={r.key}>
                      <td className="py-2 pr-2 whitespace-nowrap text-emerald-700">
                        {formatHkDateTime(r.redeemedAt)}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{r.ticketTypeLabel}</div>
                        <div className="font-mono text-[10px] text-zinc-500">
                          {r.ticketId}
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <div>{r.name}</div>
                        <div className="text-zinc-500">{r.phone}</div>
                      </td>
                      <td className="py-2 pr-2 text-zinc-600">
                        {r.checkedInBy || "-"}
                      </td>
                      <td className="py-2 text-zinc-600 max-w-[8rem] truncate">
                        {r.remark || "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
