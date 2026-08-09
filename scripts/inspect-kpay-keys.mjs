/**
 * Safe key inspection — no private key dump.
 * Run: node scripts/inspect-kpay-keys.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

function wrapPem(b64, type) {
  const body = String(b64).replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

function loadPrivate(raw) {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) {
    return crypto.createPrivateKey(trimmed);
  }
  const der = Buffer.from(trimmed.replace(/\s+/g, ""), "base64");
  try {
    return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs1" });
  }
}

function loadPublic(raw) {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) {
    return crypto.createPublicKey(trimmed);
  }
  const der = Buffer.from(trimmed.replace(/\s+/g, ""), "base64");
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

const files = [
  "secrets/merchant_private.pem",
  "secrets/merchant_public.pem",
  "852124272000001_private_key (1).pem",
  "852124272000001_public_key (1).pem",
];

console.log("=== File presence ===");
for (const f of files) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) {
    console.log(f, "MISSING");
    continue;
  }
  const raw = fs.readFileSync(p, "utf8");
  console.log(f, {
    bytes: raw.length,
    hasBegin: /BEGIN/.test(raw),
    sha16: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
    prefix: raw.trim().slice(0, 24),
  });
}

const privPath = path.join(process.cwd(), "secrets/merchant_private.pem");
const pubPath = path.join(process.cwd(), "secrets/merchant_public.pem");
const privRaw = fs.readFileSync(privPath, "utf8");
const pubRaw = fs.readFileSync(pubPath, "utf8");

console.log("\n=== Load private ===");
let privKey;
try {
  privKey = loadPrivate(privRaw);
  console.log("PRIVATE_LOAD_OK", {
    type: privKey.asymmetricKeyType,
    bits: privKey.asymmetricKeyDetails?.modulusLength,
  });
} catch (e) {
  console.log("PRIVATE_LOAD_FAIL", e.message);
}

console.log("\n=== Load public ===");
let pubKey;
try {
  pubKey = loadPublic(pubRaw);
  console.log("PUBLIC_LOAD_OK", {
    type: pubKey.asymmetricKeyType,
    bits: pubKey.asymmetricKeyDetails?.modulusLength,
  });
} catch (e) {
  console.log("PUBLIC_LOAD_FAIL", e.message);
}

if (privKey && pubKey) {
  const a = crypto.createPublicKey(privKey).export({ type: "spki", format: "der" });
  const b = pubKey.export({ type: "spki", format: "der" });
  console.log("\n=== Keypair ===");
  console.log("PUBLIC_MATCHES_PRIVATE", Buffer.compare(a, b) === 0);
  console.log(
    "pub_spki_sha16",
    crypto.createHash("sha256").update(a).digest("hex").slice(0, 16)
  );

  const payload = "test-timestamp\ntest-nonce\n{\"hello\":1}";
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payload);
  signer.end();
  const sig = signer.sign(privKey, "base64");
  console.log("SIGN_OK", { sigLen: sig.length });

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(payload);
  verifier.end();
  console.log("SELF_VERIFY_WITH_MERCHANT_PUBLIC", verifier.verify(pubKey, sig, "base64"));
}

console.log("\n=== App normalizePem path (same as kpay-crypto) ===");
function normalizePem(key, type) {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) return trimmed;
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}
try {
  const key = normalizePem(privRaw, "PRIVATE KEY");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update("test-payload");
  signer.end();
  const sig = signer.sign(key, "base64");
  console.log("APP_PATH_SIGN_OK", {
    sigLen: sig.length,
    pemHeader: key.split("\n")[0],
  });
} catch (e) {
  console.log("APP_PATH_SIGN_FAIL", e.message);
}

// Compare file hashes
const p1 = fs.readFileSync("secrets/merchant_private.pem");
const p2 = fs.existsSync("852124272000001_private_key (1).pem")
  ? fs.readFileSync("852124272000001_private_key (1).pem")
  : null;
const u1 = fs.readFileSync("secrets/merchant_public.pem");
const u2 = fs.existsSync("852124272000001_public_key (1).pem")
  ? fs.readFileSync("852124272000001_public_key (1).pem")
  : null;
console.log("\n=== File equality ===");
console.log(
  "secrets private == 852…private",
  p2 ? Buffer.compare(p1, p2) === 0 : "n/a"
);
console.log(
  "secrets public == 852…public",
  u2 ? Buffer.compare(u1, u2) === 0 : "n/a"
);
