# KPay Online Payment — Integration Test Results

**Merchant:** CONNECT INSTITUTE LIMITED  
**Product:** Ticketing System SIT (event ticket checkout)  
**Integration mode:** Merchant Mode — All Hosted Checkout  
**Prepared for:** KPay technical support / onboarding team  

| Field | Value |
|--------|--------|
| Report date | YYYY-MM-DD |
| Prepared by | |
| Environment | Sandbox ☐ · Production ☐ |
| Merchant ID (MID) | 852124272000001 (sandbox test account) |
| API base | `https://online-sandbox.kpay-group.com/api` |
| Create payment API | `POST /v1/payment/web/managed` |
| Notify URL (webhook) | `https://________________/api/webhooks/kpay` |
| Return URL pattern | `https://________________/{eventSlug}/checkout?session={outTradeNo}` |
| App / site URL | |
| Test cards used | 5454…5454 ☐ · 4917…0000 ☐ |
| 3DS password | `password` (as provided) |

---

## 1. Integration summary

| Item | Status | Notes |
|------|--------|--------|
| Merchant Mode selected (not Service Provider) | ☐ Pass · ☐ Fail · ☐ N/A | |
| Headers: `K-Nonce-Str`, `K-Merchant-Code`, `K-Signature`, `K-Timestamp`, `K-Language` | ☐ Pass · ☐ Fail | |
| Content-Type `application/json;charset=UTF-8` | ☐ Pass · ☐ Fail | |
| SHA256-RSA request signing with Merchant Private Key | ☐ Pass · ☐ Fail | Sign payload mode used: `timestamp_nonce_body` / `body_only` / `sorted_params` / other: ______ |
| Create hosted checkout → receive `paymentUrl` (`code` 10000) | ☐ Pass · ☐ Fail | |
| Browser redirect to KPay hosted page | ☐ Pass · ☐ Fail | |
| Return to merchant site after pay | ☐ Pass · ☐ Fail | |
| Async notify / webhook received | ☐ Pass · ☐ Fail · ☐ Not tested | |
| Webhook signature verify with Merchant Platform Public Key | ☐ Pass · ☐ Fail · ☐ Not tested | |
| Order status query (if used) | ☐ Pass · ☐ Fail · ☐ N/A | |
| Amounts to 2 decimal places (BigDecimal) | ☐ Pass · ☐ Fail | |
| Snowflake / order IDs handled as strings (no JS precision loss) | ☐ Pass · ☐ Fail | |

---

## 2. Test cases (fill results)

Use these in addition to (or as a copy of) **KPay線上支付測試案例表格**.  
**Result:** Pass / Fail / Blocked / N/A  
**Evidence:** `outTradeNo`, screenshot name, or log excerpt (no private keys).

### 2.1 Create payment (hosted checkout)

| # | Case | Steps | Expected | Result | outTradeNo / evidence | Date/time |
|---|------|--------|----------|--------|------------------------|-----------|
| C1 | Create order – valid HKD amount | Cart checkout → Pay with KPay | HTTP OK, `code=10000`, `data.paymentUrl` present | | | |
| C2 | Redirect to hosted checkout | Open `paymentUrl` | KPay sandbox pay page loads | | | |
| C3 | Pay success – Card 1 | Card `5454 5454 5454 5454`, exp `03/30`, CVV `737`, 3DS `password` | Payment success; return to merchant | | | |
| C4 | Pay success – Card 2 | Card `4917 6100 0000 0000`, same exp/CVV/3DS | Same as C3 | | | |
| C5 | Pay cancel / abandon | Open checkout, cancel or close | Merchant shows cancel/retry; no false “paid” order | | | |
| C6 | Pay fail (if sandbox supports) | Invalid card / fail path if available | Fail status; no ticket issued | | | |
| C7 | Duplicate outTradeNo | Reuse same `outTradeNo` (if testable) | Gateway rejects or handles per spec | | | |
| C8 | Zero / invalid amount | amount ≤ 0 | Rejected before or by API | | | |

### 2.2 Return URL (browser return)

| # | Case | Steps | Expected | Result | Evidence | Date/time |
|---|------|--------|----------|--------|----------|-----------|
| R1 | Success return | Complete pay → redirect | Land on merchant checkout/success with session/`outTradeNo` | | | |
| R2 | Order finalized on return | After return | Purchase saved; confirmation page; ticket download | | | |
| R3 | Refresh return page | Refresh once | No double charge; no duplicate orders (or safe idempotency) | | | |

### 2.3 Async notification (webhook)

| # | Case | Steps | Expected | Result | Evidence | Date/time |
|---|------|--------|----------|--------|----------|-----------|
| W1 | Notify URL reachable | KPay POST to `/api/webhooks/kpay` | HTTP 200; body acknowledged | | | |
| W2 | Signature valid | Signed notify | Signature verified with platform public key | | | |
| W3 | Signature invalid | Tampered body/sig | Rejected (e.g. 401); order not marked paid | | | |
| W4 | Idempotent notify | Same success notify twice | Second call no duplicate order | | | |
| W5 | Notify without browser return | If possible | Order still completed via webhook | | | |

### 2.4 Business / ticket platform (merchant side)

| # | Case | Steps | Expected | Result | Evidence | Date/time |
|---|------|--------|----------|--------|----------|-----------|
| B1 | Single ticket paid | Buy 1 ticket | Correct amount; 1 PDF serial | | | |
| B2 | Multi ticket paid | Buy 2+ types | Correct total; multiple serials | | | |
| B3 | Discount / promo (if any) | Apply code then pay | payAmount matches discounted total | | | |
| B4 | Confirmation email | After paid | Email with order ref + download link | | | |
| B5 | Free registration (no KPay) | Free event path | No KPay call; free ref only | | | N/A for KPay gateway |

---

## 3. Sample technical evidence (attach or paste)

### 3.1 Create payment (redact secrets)

```
Request:
  POST {API_BASE}/v1/payment/web/managed
  Headers: K-Merchant-Code=852124272000001, K-Timestamp=..., K-Nonce-Str=..., K-Language=en_US, K-Signature=<redacted>
  Body (example):
  {
    "outTradeNo": "SIT............",
    "orderType": "SALES",
    "browserType": "WEB",
    "payAmount": 00.00,
    "currency": "HKD",
    "itemList": [ { "productId": 1, "productName": "...", "productIcon": "...", "productPrice": 00.00, "productQuantity": 1 } ],
    "returnUrl": "...",
    "notifyUrl": "..."
  }

Response:
  HTTP status: ____
  code: ____
  message: ____
  paymentUrl: present ☐ yes ☐ no
```

### 3.2 Successful payment references

| Test # | outTradeNo | KPay managed/order no (if any) | Amount (HKD) | Result |
|--------|------------|--------------------------------|--------------|--------|
| C3 | | | | |
| C4 | | | | |

### 3.3 Screenshots checklist (attach files)

- [ ] Hosted checkout page (sandbox)
- [ ] 3DS / card entry (if allowed; mask PAN)
- [ ] Payment success on KPay side
- [ ] Merchant success / ticket page
- [ ] Webhook server log (timestamp + outTradeNo, no private keys)

---

## 4. Merchant website requirements (KPay checklist)

| Requirement | Status | URL / notes |
|-------------|--------|-------------|
| Accessible web page URL | ☐ Done · ☐ Pending | |
| Catalog, description, pricing of goods/services | ☐ Done · ☐ Pending | Event + ticket types in app |
| Company contact information | ☐ Done · ☐ Pending | |
| Check-out system (cart) | ☐ Done · ☐ Pending | Ticketing cart + checkout |
| Returns & refunds policy | ☐ Done · ☐ Pending | Link: |
| Delivery policy | ☐ Done · ☐ Pending | Digital tickets / event entry |
| Data privacy policy | ☐ Done · ☐ Pending | Link: |

---

## 5. Issues / questions for KPay (if any)

| # | Issue | Request / question | Blocking? |
|---|--------|--------------------|-----------|
| 1 | | Exact string-to-sign for `K-Signature` (if not matching) | ☐ Yes · ☐ No |
| 2 | | Confirm production API base URL when going live | ☐ Yes · ☐ No |
| 3 | | Webhook body field names for success status | ☐ Yes · ☐ No |
| 4 | | | |

---

## 6. Sign-off

| Role | Name | Date | Signature / OK |
|------|------|------|----------------|
| Merchant technical | | | ☐ |
| Merchant business | | | ☐ |
| KPay (acknowledgement) | | | ☐ |

---

## Appendix A — Email draft to KPay

**Subject:** CONNECT INSTITUTE LIMITED — KPay Online Payment sandbox test results (Merchant Mode / Hosted Checkout)

Dear KPay technical support,

Please find attached our sandbox integration test results for Merchant Mode (All Hosted Checkout).

- Merchant ID (sandbox): 852124272000001  
- Integration: REST JSON, headers as per specification, SHA256-RSA signing  
- Create API: `POST /v1/payment/web/managed`  
- Notify URL: `[your public webhook URL]`  
- Summary: [X] cases passed, [Y] failed, [Z] blocked / not tested  

Attached:
1. This completed test results document  
2. Screenshots / logs (PAN masked)  

Please confirm receipt and advise if any additional cases from your official test sheet are required before production credentials.

Thank you,  
[Name]  
CONNECT INSTITUTE LIMITED  
[Contact]

---

## Appendix B — How we run tests (internal)

1. Set env: `KPAY_MERCHANT_CODE`, `KPAY_MERCHANT_PRIVATE_KEY`, `KPAY_PLATFORM_PUBLIC_KEY`, `KPAY_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`.
2. For webhook: public HTTPS URL (or tunnel) pointing to `/api/webhooks/kpay`.
3. Restart app after env change.
4. On Pay: confirm logs show **not** “DEVELOPMENT SIMULATION” and `hasPrivateKey: true`.
5. Complete hosted checkout with test card.
6. Record `outTradeNo` (session id) and result in tables above.
7. Never send private keys or full card numbers in the report (mask PAN).
