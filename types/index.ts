/**
 * Core Type Definitions for Ticketing System SIT
 * 
 * These interfaces define the contracts used across the application.
 * They enable modularity: new events, different DBs, or payment providers
 * can be plugged in by conforming to these shapes.
 */

// ============================================
// EVENT & TICKET CONFIGURATION
// ============================================

export interface TicketType {
  id: string;
  name: string;
  description?: string;
  price: number; // in the currency unit (e.g. HKD)
  currency: string; // e.g. "HKD"
  maxPerOrder?: number;
  enabled?: boolean; // defaults to true if omitted
}

export interface EventConfig {
  slug: string;
  name: string;
  description: string;
  date: string; // ISO date or human readable - stored as string for simplicity
  time?: string;
  location: string;
  image?: string; // optional hero image path (public/)
  ticketTypes: TicketType[];
  enabled?: boolean; // whether the event is publicly available
  // Optional metadata for future extensibility (WP site link etc.)
  metadata?: Record<string, unknown>;
}

// ============================================
// BUYER & ORDER DATA
// ============================================

export interface BuyerInfo {
  name: string;
  phone: string;
  email: string;
}

export interface TicketSelection {
  ticketTypeId: string;
  quantity: number;
}

// Full cart state passed between pages / used for calculations
export interface OrderCart {
  eventSlug: string;
  tickets: TicketSelection[];
  buyer: BuyerInfo;
  totalAmount: number;
  currency: string;
}

// ============================================
// PURCHASE RECORD (Database model)
// ============================================

export interface PurchaseRecord {
  id?: string | number; // DB generated
  bought_at: string; // ISO timestamp
  name: string;
  phone: string;
  email: string;
  number_of_tickets: number; // total quantity
  payment_method: string; // e.g. "wonder", "credit_card"
  amount: number;
  currency?: string;
  event_slug: string;
  // Optional rich data for future reporting
  ticket_breakdown?: TicketSelection[];
  order_reference?: string; // From WooCommerce or internal
  payment_reference?: string; // From Wonder
}

// ============================================
// SERVICE ABSTRACTION RESULTS
// ============================================

export interface OrderCreationResult {
  success: boolean;
  orderId?: string | number;
  orderReference?: string;
  error?: string;
  // Any extra metadata from external systems
  metadata?: Record<string, unknown>;
}

export interface PaymentInitiationResult {
  success: boolean;
  redirectUrl?: string;
  paymentId?: string;
  error?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface TicketPdfResult {
  success: boolean;
  pdfBuffer?: Buffer;
  filename?: string;
  error?: string;
}

// ============================================
// WOO / EXTERNAL ORDER PAYLOAD
// (internal to woocommerce service)
// ============================================

export interface WooOrderPayload {
  payment_method: string;
  payment_method_title: string;
  set_paid: boolean;
  billing: {
    first_name: string;
    last_name?: string;
    email: string;
    phone: string;
  };
  line_items: Array<{
    name: string;
    quantity: number;
    total: string; // string to avoid floating point issues
  }>;
  meta_data?: Array<{
    key: string;
    value: string | number;
  }>;
}
