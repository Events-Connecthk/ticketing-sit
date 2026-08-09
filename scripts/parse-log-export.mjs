import fs from "fs";

const path = process.argv[2] || "G:/ticketing-sit-log-export-2026-07-13T01-55-07.csv";
const raw = fs.readFileSync(path, "utf8");

// Vercel CSV can embed newlines inside quoted fields — split rows carefully enough for our needs
const chunks = raw.split(/(?=\d{4}-\d{2}-\d{2} )/g);

const interesting = [];
for (const c of chunks) {
  if (
    !/Webhook|webhook|confirm state|Order status|Order API|signature verify|Purchase|Not paid|processSuccessful|Email|PendingPayments|Paid recorded|managedOrderState|st: 'paid'|st: 'failed'|st: 'unknown'/i.test(
      c
    )
  ) {
    continue;
  }
  const time = (c.match(/^(\d{4}-\d{2}-\d{2} [\d:]+)/) || [])[1] || "";
  const level = (c.match(/,(info|warning|error),/) || [])[1] || "";
  const isWebhook = /\/api\/webhooks\/kpay/.test(c);
  const snippets = [];
  for (const re of [
    /\[KPay Webhook\][^\n]{0,300}/g,
    /\[KPay\][^\n]{0,300}/g,
    /\[PendingPayments\][^\n]{0,200}/g,
    /\[Email\][^\n]{0,200}/g,
    /Order status poll[\s\S]{0,150}/g,
    /Order result query[\s\S]{0,200}/g,
    /confirm state[\s\S]{0,250}/g,
    /Paid recorded[^\n]{0,200}/g,
    /signature verify[^\n]{0,150}/g,
  ]) {
    const m = c.match(re);
    if (m) snippets.push(...m.map((s) => s.replace(/\s+/g, " ").slice(0, 280)));
  }
  if (!snippets.length) continue;
  interesting.push({
    time,
    level,
    isWebhook,
    text: [...new Set(snippets)].join(" || "),
  });
}

const seen = new Set();
for (const row of interesting) {
  const k = row.time + "|" + row.text.slice(0, 100);
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`${row.time} [${row.level}] webhook=${row.isWebhook}`);
  console.log("  " + row.text);
  console.log("");
}
console.log("--- total unique", seen.size);
