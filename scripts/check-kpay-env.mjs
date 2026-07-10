import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.log("NO .env.local");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  let k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}

function checkPath(p) {
  if (!p) return { ok: false, reason: "not set" };
  const r = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  if (!fs.existsSync(r)) return { ok: false, reason: "file missing", path: r };
  const t = fs.readFileSync(r, "utf8");
  const begin = /BEGIN (RSA )?PRIVATE KEY|BEGIN PUBLIC KEY|BEGIN CERTIFICATE/.test(
    t
  );
  return { ok: true, file: path.basename(r), bytes: t.length, pemHeader: begin };
}

const mid = env.KPAY_MERCHANT_CODE || env.KPAY_MERCHANT_ID || env.KPAY_API_KEY;
const privPath = checkPath(env.KPAY_MERCHANT_PRIVATE_KEY_PATH);
const platPath = checkPath(env.KPAY_PLATFORM_PUBLIC_KEY_PATH);
const privInline = Boolean(env.KPAY_MERCHANT_PRIVATE_KEY || env.KPAY_PRIVATE_KEY);
const platInline = Boolean(
  env.KPAY_PLATFORM_PUBLIC_KEY || env.KPAY_MERCHANT_PLATFORM_PUBLIC_KEY
);

console.log("MERCHANT_CODE:", mid ? "set" : "MISSING");
console.log("API_BASE:", env.KPAY_API_BASE_URL || "(default sandbox)");
console.log("SITE_URL:", env.NEXT_PUBLIC_SITE_URL || "(default localhost)");
console.log("PRIVATE_KEY_PATH:", JSON.stringify(privPath));
console.log("PRIVATE_KEY_INLINE:", privInline ? "set" : "not set");
console.log("PLATFORM_PUBLIC_PATH:", JSON.stringify(platPath));
console.log("PLATFORM_PUBLIC_INLINE:", platInline ? "set" : "not set");

const ready = Boolean(mid && (privPath.ok || privInline));
console.log("READY_FOR_REAL_KPAY:", ready);
if (!ready) {
  console.log(
    "TIP: set KPAY_MERCHANT_CODE + KPAY_MERCHANT_PRIVATE_KEY_PATH (or inline key)"
  );
  process.exit(2);
}
