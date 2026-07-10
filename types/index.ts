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
  /** Total tickets of this type for the event. Omit / leave empty = unlimited. */
  quantityAvailable?: number;
  enabled?: boolean; // defaults to true if omitted
  discounts?: DiscountRule[]; // customizable discounts
  redemptionLimit?: number; // how many times this ticket can be redeemed (e.g. 1 = single day, 3 = 3-day access)
}

export interface DiscountRule {
  id: string;
  name: string; // e.g. "Early Bird", "Student Discount", "Group of 5"
  type: 'early_bird' | 'student' | 'group' | 'custom';
  value: number; // discount percent, e.g. 20 = 20% off
  validUntil?: string; // ISO date string, for early_bird etc.
  minQuantity?: number; // for group discounts
}

// Independent promo/discount codes (event-level, entered at checkout)
export interface DiscountCode {
  id: string;
  code: string;          // uppercase promo code e.g. "SUMMER20"
  percent: number;       // e.g. 15 for 15% off
  maxUses?: number;
  description?: string;
}

export interface EventConfig {
  slug: string;
  name: string;
  description: string;
  date: string; // start date
  endDate?: string; // sales end date / event end
  time?: string;
  location: string;
  image?: string; // optional hero image path (public/)
  ticketTypes: TicketType[];
  enabled?: boolean; // whether the event is publicly available
  // Custom buyer form fields per event
  buyerFormFields?: BuyerFormField[];
  // Independent discount/promo codes (usable at checkout, not tied to specific ticket types)
  discountCodes?: DiscountCode[];
  // Whether this event requires payment (false = free registration only)
  paymentEnabled?: boolean;
  // Custom ticket template PDF path (e.g. /ticket-templates/my-event.pdf)
  // The dynamic text/QR will be overlaid at the same positions as the default template
  ticketTemplate?: string;
  // Optional metadata for future extensibility
  metadata?: Record<string, unknown>;
}

export interface BuyerFormField {
  id: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'textarea';
  required?: boolean;
  placeholder?: string;
  options?: string[]; // for select
}

// ============================================
// BUYER & ORDER DATA
// ============================================

export interface BuyerInfo {
  name: string;
  phone: string;
  email: string;
  // Custom fields from event-specific form
  customFields?: Record<string, string>;
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
  // Applied event-level promo code (independent of ticket types)
  appliedDiscountCode?: string;
  discountAmount?: number;
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
  payment_method: string; // e.g. "kpay", "credit_card"
  amount: number;
  currency?: string;
  event_slug: string;
  // Rich data: after checkout each unit has quantity:1 + serial (KPY-xxx-001, …)
  // Legacy rows may still be { ticketTypeId, quantity: N } without serial.
  ticket_breakdown?: Array<
    TicketSelection & { serial?: string; redemptions?: string[] }
  >;
  order_reference?: string; // Order-level ref e.g. KPY-1783...
  payment_reference?: string; // From KPay or FREE-...
  redeemed_at?: string; // Legacy order-level redemption
  redemptions?: string[]; // Legacy order-level multi-day redemptions
  // Applied discount code (if any)
  applied_discount_code?: string;
  discount_amount?: number;
  // Custom buyer answers
  customBuyerInfo?: Record<string, string>;
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
  pdfBuffer?: Uint8Array;
  filename?: string;
  error?: string;
}

// (Legacy WooCommerce payload interface removed - no longer used)
