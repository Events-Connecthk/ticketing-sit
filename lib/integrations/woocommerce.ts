/**
 * WooCommerce Integration (OPTIONAL)
 *
 * Optionally creates orders in an external WordPress + WooCommerce + Tickera site.
 *
 * The ticketing platform itself is fully standalone.
 * A WordPress site simply redirects users (via a "Buy Ticket" button) to this app.
 *
 * Authentication: Basic Auth using Consumer Key + Secret (WC_REST_API)
 * Endpoint: `${WP_SITE_URL}/wp-json/wc/v3/orders`
 *
 * When the required env vars are missing, this gracefully falls back to a simulated order.
 */

import { OrderCart, WooOrderPayload, OrderCreationResult } from "@/types";

// Environment driven configuration (never hardcode)
const WP_SITE_URL = process.env.WP_SITE_URL || "";
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || "";
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || "";

function getWooAuthHeader(): string {
  const credentials = Buffer.from(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Map our internal cart + event data into WooCommerce order payload.
 * Keeps the mapping explicit and easy to audit/adjust.
 */
function buildWooOrderPayload(params: {
  cart: OrderCart;
  eventName: string;
  paymentReference: string;
}): WooOrderPayload {
  const { cart, eventName, paymentReference } = params;
  const total = cart.totalAmount.toFixed(2);

  // Build line items with descriptive names
  const lineItems = cart.tickets.map((selection) => {
    // In real usage you would resolve the ticket name from event config here.
    // We keep names descriptive for Tickera/Woo.
    return {
      name: `${eventName} - Ticket`,
      quantity: selection.quantity,
      total: (selection.quantity * 0).toFixed(2), // placeholder until prices resolved
    };
  });

  // Better: recompute actual line totals using the cart (already has totalAmount)
  // Simplified: one aggregated line item is often cleaner for events.
  const aggregatedLineItems = [
    {
      name: `${eventName} Tickets`,
      quantity: cart.tickets.reduce((s, t) => s + t.quantity, 0),
      total,
    },
  ];

  return {
    payment_method: "wonder",
    payment_method_title: "Wonder Payment",
    set_paid: true, // We only call this after successful Wonder payment
    billing: {
      first_name: cart.buyer.name.split(" ")[0] || cart.buyer.name,
      last_name: cart.buyer.name.split(" ").slice(1).join(" ") || "",
      email: cart.buyer.email,
      phone: cart.buyer.phone,
    },
    line_items: aggregatedLineItems,
    meta_data: [
      { key: "_wonder_payment_reference", value: paymentReference },
      { key: "_event_slug", value: cart.eventSlug },
      { key: "_ticket_breakdown", value: JSON.stringify(cart.tickets) },
    ],
  };
}

/**
 * Create order in WooCommerce.
 * Returns standardized result used by the order service.
 */
export async function createWooCommerceOrder(params: {
  cart: OrderCart;
  eventName: string;
  paymentReference: string;
}): Promise<OrderCreationResult> {
  if (!WP_SITE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    console.warn("[WooCommerce] Missing WP/WC environment variables. Order not created in Woo.");
    // Return synthetic success so flow can continue for development
    return {
      success: true,
      orderReference: `DEV-${Date.now()}`,
      orderId: `dev-${Date.now()}`,
      metadata: { simulated: true },
    };
  }

  const payload = buildWooOrderPayload(params);
  const url = `${WP_SITE_URL.replace(/\/$/, "")}/wp-json/wc/v3/orders`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getWooAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[WooCommerce] Order creation failed:", res.status, errorText);
      return {
        success: false,
        error: `WooCommerce API error: ${res.status}`,
      };
    }

    const order = await res.json();

    return {
      success: true,
      orderId: order.id,
      orderReference: order.number ? String(order.number) : String(order.id),
      metadata: { wooStatus: order.status },
    };
  } catch (err) {
    console.error("[WooCommerce] Network / parse error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "WooCommerce request failed",
    };
  }
}
