import fs from "fs";
import crypto from "crypto";

const path = process.argv[2] || "secrets/kpay_platform_public.pem";
if (!fs.existsSync(path)) {
  console.log("MISSING", path);
  process.exit(1);
}
const raw = fs.readFileSync(path, "utf8");
const merPath = "secrets/merchant_public.pem";
const mer = fs.existsSync(merPath) ? fs.readFileSync(merPath, "utf8") : "";

console.log({
  path,
  bytes: raw.length,
  hasBegin: /BEGIN/.test(raw),
  isCert: /CERTIFICATE/.test(raw),
  isPub: /PUBLIC KEY/.test(raw),
  firstLine: raw.trim().split(/\r?\n/)[0]?.slice(0, 50),
  sameAsMerchantPublic: mer ? raw.trim() === mer.trim() : "n/a",
});

function wrap(b64, type) {
  const body = b64.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

function tryLoad(label, key) {
  try {
    const k = crypto.createPublicKey(key);
    const der = k.export({ type: "spki", format: "der" });
    console.log(
      label,
      "OK",
      "sha16",
      crypto.createHash("sha256").update(der).digest("hex").slice(0, 16)
    );
  } catch (e) {
    console.log(label, "FAIL", e.message);
  }
}

const trimmed = raw.trim().replace(/\\n/g, "\n");
if (trimmed.includes("BEGIN")) {
  tryLoad("as-pem", trimmed);
} else {
  tryLoad("wrap-PUBLIC-KEY", wrap(trimmed, "PUBLIC KEY"));
  tryLoad("wrap-RSA-PUBLIC-KEY", wrap(trimmed, "RSA PUBLIC KEY"));
}

if (mer) {
  try {
    const a = crypto.createPublicKey(
      mer.includes("BEGIN")
        ? mer.trim()
        : wrap(mer, "PUBLIC KEY")
    );
    const b = crypto.createPublicKey(
      trimmed.includes("BEGIN")
        ? trimmed
        : wrap(trimmed, "PUBLIC KEY")
    );
    const da = a.export({ type: "spki", format: "der" });
    const db = b.export({ type: "spki", format: "der" });
    console.log(
      "fingerprintMatchMerchant",
      Buffer.compare(da, db) === 0
    );
  } catch (e) {
    console.log("compareFail", e.message);
  }
}
