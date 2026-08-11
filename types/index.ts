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
  /** Public visibility on the ticketing page. defaults to true if omitted */
  enabled?: boolean;
  /**
   * If true, this type is free: counts as HKD 0 and never triggers KPay.
   * Cart of only free types issues tickets immediately (like free events).
   */
  isFree?: boolean;
  /**
   * Archived types stay for historical purchases but are not sold.
   * Use when day coverage must change after sales (create a new type instead).
   */
  archived?: boolean;
  discounts?: DiscountRule[]; // customizable discounts
  redemptionLimit?: number; // how many times this ticket can be redeemed (e.g. 1 = single day, 3 = 3-day access)
  /**
   * Explicit event-day coverage (YYYY-MM-DD list). Preferred over validFrom/validTo
   * for multi-day seat capacity. Must be a non-empty subset of event.seatDays when
   * seat days are configured. Immutable after tickets of this type are sold.
   */
  coveredDays?: string[];
  /**
   * Optional calendar validity (YYYY-MM-DD, Hong Kong day).
   * Used by admin scanner - e.g. Day-1 only vs Day-2 only.
   * Also used as coverage range when coveredDays is empty.
   * Omit both = valid any day / all seat days.
   */
  validFrom?: string;
  validTo?: string;
  /** Optional sale window (YYYY-MM-DD) — when this type can be purchased */
  saleFrom?: string;
  saleUntil?: string;
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
  /** YYYY-MM-DD — code becomes available this day (HK). Empty = already open */
  validFrom?: string;
  /** YYYY-MM-DD — code closes end of this day (HK). Empty = no expiry */
  validUntil?: string;
}

/** Per-calendar-day seat pool (shared across ticket types covering that day). */
export interface SeatDayCapacity {
  /** YYYY-MM-DD (Hong Kong event day) */
  date: string;
  /** Total seats available that day (shared) */
  capacity: number;
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
  /** Optional donation at checkout (stored in event.metadata) */
  donationEnabled?: boolean;
  /** Default donation amount shown to buyer (they can change it) */
  donationDefaultAmount?: number;
  /**
   * Shared seating by day (stored in metadata.seatDays).
   * A multi-day ticket (validFrom–validTo spanning days) deducts 1 seat from each day it covers.
   */
  seatDays?: SeatDayCapacity[];
  /**
   * When true, public ticket page does not show remaining seat counts.
   * Capacity still enforced; only the display is hidden.
   */
  hideSeatCounts?: boolean;
  /**
   * Per-event admin notification emails (comma-separated).
   * Used for new orders and ticket change/delete alerts for this event.
   * Falls back to env ADMIN_NOTIFY_EMAIL / REPLY_TO if empty.
   */
  adminNotifyEmail?: string;
  /**
   * Require buyer to accept Terms & Conditions before checkout / registration.
   * Stored in metadata.termsEnabled.
   */
  termsEnabled?: boolean;
  /**
   * Public URL/path to T&C PDF. Empty = use platform default
   * (/legal/default-terms.pdf).
   */
  termsUrl?: string;
  // Optional metadata for future extensibility
  metadata?: Record<string, unknown>;
}

/** Default T&C PDF when event enables terms but has no custom upload. */
export const DEFAULT_TERMS_PDF_PATH = "/legal/default-terms.pdf";

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
  /** Total charged (tickets after discount + donation) */
  totalAmount: number;
  currency: string;
  // Applied event-level promo code (independent of ticket types)
  appliedDiscountCode?: string;
  discountAmount?: number;
  /** Ticket subtotal after discount (excludes donation) */
  ticketAmount?: number;
  /** Optional donation amount (tracked separately) */
  donationAmount?: number;
}

/** Donation record (separate table from purchases) */
export interface DonationRecord {
  id?: string | number;
  donated_at: string;
  name: string;
  phone: string;
  email: string;
  amount: number;
  currency?: string;
  event_slug: string;
  order_reference?: string;
  payment_reference?: string;
  payment_method?: string;
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
    TicketSelection & {
      serial?: string;
      /** ISO strings (legacy) or { at, byName?, remark? } */
      redemptions?: Array<
        string | { at: string; byId?: string; byName?: string; remark?: string }
      >;
    }
  >;
  order_reference?: string; // Order-level ref e.g. KPY-1783...
  payment_reference?: string; // From KPay or FREE-...
  redeemed_at?: string; // Legacy order-level redemption
  /** ISO strings (legacy) or structured check-in records */
  redemptions?: Array<
    string | { at: string; byId?: string; byName?: string; remark?: string }
  >;
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
