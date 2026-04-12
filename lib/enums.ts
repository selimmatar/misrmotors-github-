/**
 * CANONICAL STATUS & ENUM DEFINITIONS
 * Single source of truth for all status values in the ERP system.
 * These values MUST match the database CHECK constraints exactly.
 *
 * NEVER use raw strings for status values - import from this module instead.
 */

// ============================================================================
// ACCOUNTS PAYABLE (AP) / SUPPLIER INVOICES
// DB: CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))
// ============================================================================
export const AP_STATUS = {
  PENDING: "pending",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  OVERDUE: "overdue",
} as const

export type APStatus = (typeof AP_STATUS)[keyof typeof AP_STATUS]

export const AP_STATUS_VALUES: readonly APStatus[] = [
  AP_STATUS.PENDING,
  AP_STATUS.PARTIALLY_PAID,
  AP_STATUS.PAID,
  AP_STATUS.OVERDUE,
] as const

// ============================================================================
// ACCOUNTS RECEIVABLE (AR) / CUSTOMER INVOICES
// DB: CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))
// ============================================================================
export const AR_STATUS = {
  PENDING: "pending",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  OVERDUE: "overdue",
} as const

export type ARStatus = (typeof AR_STATUS)[keyof typeof AR_STATUS]

export const AR_STATUS_VALUES: readonly ARStatus[] = [
  AR_STATUS.PENDING,
  AR_STATUS.PARTIALLY_PAID,
  AR_STATUS.PAID,
  AR_STATUS.OVERDUE,
] as const

// ============================================================================
// PAYMENT SCHEDULES
// DB: CHECK (status IN ('pending', 'paid', 'overdue', 'partial'))
// NOTE: 'partial' is ONLY valid for payment_schedules, NOT for AP/AR invoices!
// ============================================================================
export const SCHEDULE_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  PARTIAL: "partial", // Only for schedules, NOT for invoices!
} as const

export type ScheduleStatus = (typeof SCHEDULE_STATUS)[keyof typeof SCHEDULE_STATUS]

export const SCHEDULE_STATUS_VALUES: readonly ScheduleStatus[] = [
  SCHEDULE_STATUS.PENDING,
  SCHEDULE_STATUS.PAID,
  SCHEDULE_STATUS.OVERDUE,
  SCHEDULE_STATUS.PARTIAL,
] as const

// ============================================================================
// PURCHASE ORDERS
// DB: CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received'))
// ============================================================================
export const PO_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECEIVED: "received",
} as const

export type POStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS]

export const PO_STATUS_VALUES: readonly POStatus[] = [
  PO_STATUS.DRAFT,
  PO_STATUS.PENDING,
  PO_STATUS.APPROVED,
  PO_STATUS.REJECTED,
  PO_STATUS.RECEIVED,
] as const

// ============================================================================
// SALES ORDERS
// DB: CHECK (status IN ('draft', 'pending', 'pending_accountant', 'accountant_approved',
//           'ready_for_delivery', 'shipped', 'delivered', 'cancelled'))
// ============================================================================
export const SO_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  PENDING_ACCOUNTANT: "pending_accountant",
  ACCOUNTANT_APPROVED: "accountant_approved",
  READY_FOR_DELIVERY: "ready_for_delivery",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
} as const

export type SOStatus = (typeof SO_STATUS)[keyof typeof SO_STATUS]

export const SO_STATUS_VALUES: readonly SOStatus[] = [
  SO_STATUS.DRAFT,
  SO_STATUS.PENDING,
  SO_STATUS.PENDING_ACCOUNTANT,
  SO_STATUS.ACCOUNTANT_APPROVED,
  SO_STATUS.READY_FOR_DELIVERY,
  SO_STATUS.SHIPPED,
  SO_STATUS.DELIVERED,
  SO_STATUS.CANCELLED,
] as const

// ============================================================================
// DELIVERY PERMITS
// DB: CHECK (status IN ('DRAFT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY',
//           'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'))
// ============================================================================
export const DP_STATUS = {
  DRAFT: "DRAFT",
  PRINTED: "PRINTED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  SUBMITTED_SIGNED: "SUBMITTED_SIGNED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const

export type DPStatus = (typeof DP_STATUS)[keyof typeof DP_STATUS]

// ============================================================================
// BALANCE ENTRIES
// DB: CHECK (status IN ('active', 'voided'))
// ============================================================================
export const BALANCE_STATUS = {
  ACTIVE: "active",
  VOIDED: "voided",
} as const

export type BalanceStatus = (typeof BALANCE_STATUS)[keyof typeof BALANCE_STATUS]

// ============================================================================
// ENTITY STATUS (Customers, Suppliers)
// DB: CHECK (status IN ('active', 'inactive'))
// ============================================================================
export const ENTITY_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const

export type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS]

// ============================================================================
// PAYMENT TERMS
// DB: CHECK (payment_terms IN ('prepaid', 'installment'))
// Extended in app: 'cash', 'cheque', 'hybrid'
// ============================================================================
export const PAYMENT_TERMS = {
  PREPAID: "prepaid",
  INSTALLMENT: "installment",
  CASH: "cash",
  CHEQUE: "cheque",
  HYBRID: "hybrid",
} as const

export type PaymentTerms = (typeof PAYMENT_TERMS)[keyof typeof PAYMENT_TERMS]

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates if a value is a valid AP invoice status
 */
export function isValidAPStatus(value: unknown): value is APStatus {
  return AP_STATUS_VALUES.includes(value as APStatus)
}

/**
 * Validates if a value is a valid AR invoice status
 */
export function isValidARStatus(value: unknown): value is ARStatus {
  return AR_STATUS_VALUES.includes(value as ARStatus)
}

/**
 * Validates if a value is a valid payment schedule status
 */
export function isValidScheduleStatus(value: unknown): value is ScheduleStatus {
  return SCHEDULE_STATUS_VALUES.includes(value as ScheduleStatus)
}

/**
 * Computes invoice status based on paid vs total amount
 * Returns DB-valid status values only (partially_paid, NOT partial)
 */
export function computeInvoiceStatus(paidAmount: number, totalAmount: number, dueDate?: string | Date): APStatus {
  if (paidAmount >= totalAmount) {
    return AP_STATUS.PAID
  }

  if (paidAmount > 0) {
    return AP_STATUS.PARTIALLY_PAID // NEVER "partial" for invoices!
  }

  // Check if overdue
  if (dueDate) {
    const due = new Date(dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    due.setHours(0, 0, 0, 0)

    if (due < today) {
      return AP_STATUS.OVERDUE
    }
  }

  return AP_STATUS.PENDING
}

/**
 * Computes schedule entry status based on paid vs total amount
 * Uses "partial" for schedules (NOT "partially_paid")
 */
export function computeScheduleStatus(
  paidAmount: number,
  totalAmount: number,
  dueDate?: string | Date,
): ScheduleStatus {
  if (paidAmount >= totalAmount) {
    return SCHEDULE_STATUS.PAID
  }

  if (paidAmount > 0) {
    return SCHEDULE_STATUS.PARTIAL // "partial" is correct for schedules!
  }

  // Check if overdue
  if (dueDate) {
    const due = new Date(dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    due.setHours(0, 0, 0, 0)

    if (due < today) {
      return SCHEDULE_STATUS.OVERDUE
    }
  }

  return SCHEDULE_STATUS.PENDING
}
