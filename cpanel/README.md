# KPay egress proxy (cPanel)

Gives KPay a **fixed outbound IP** without Vercel Static IPs.

App stays on Vercel. Only **outbound** KPay API calls go through this PHP script on cPanel.

## 1. Upload

1. Open cPanel → **File Manager** → `public_html` (or a subfolder).
2. Upload `kpay-egress-proxy.php`.
3. Edit the file on the server: set `PROXY_SECRET` to a long random string  
   (example: run `openssl rand -hex 32` on your PC).

Public URL example:

`https://YOUR-DOMAIN.com/kpay-egress-proxy.php`

## 2. Get the outbound IP (send this to KPay later)

In a browser open:

`https://YOUR-DOMAIN.com/kpay-egress-proxy.php?action=ip`

You should see JSON like:

```json
{
  "ok": true,
  "outboundIp": "x.x.x.x"
}
```

Copy `outboundIp`. That is what KPay will see for production whitelist.

Also check health:

`https://YOUR-DOMAIN.com/kpay-egress-proxy.php?action=health`

`secretConfigured` should be `true`.

## 3. Wire the app (UAT first)

### Local `.env.local`

```env
KPAY_API_BASE_URL=https://payment.uat.kpay-group.com
KPAY_EGRESS_PROXY_URL=https://YOUR-DOMAIN.com/kpay-egress-proxy.php
KPAY_EGRESS_PROXY_SECRET=same-secret-as-php
```

### Vercel (Production / Preview)

Same two vars. Redeploy after saving.

Leave **unset** to call KPay directly again (no proxy).

## 4. UAT test checklist

1. Proxy health + IP pages work.
2. Start app / redeploy with proxy env set.
3. Start a checkout (UAT test card).
4. In logs look for: `[KPay] Using egress proxy for POST ...`
5. Payment create should still return success + payment URL.
6. Complete pay; webhook still hits **Vercel** (not cPanel) — that is expected.

If create fails with 401 from proxy → secret mismatch.  
If 403 host not allowlisted → wrong KPay base URL host.  
If 502 → cPanel cannot reach KPay (firewall / curl / SSL).

## 5. Production later

1. Same proxy (or second file) with prod KPay host already allowlisted.
2. Tell KPay the `outboundIp` from `?action=ip`.
3. Switch `KPAY_API_BASE_URL` + prod keys when they go live.
4. Keep webhook on `https://ticketing-sit.connecthk.org/api/webhooks/kpay`.

## Security

- Never commit a real `PROXY_SECRET`.
- Do not call this PHP from the browser with the secret.
- Only Vercel / server env should send `X-Egress-Secret`.
- File only allows KPay hosts listed in `ALLOWED_HOSTS`.
