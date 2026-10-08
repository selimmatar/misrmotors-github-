/**
 * CANONICAL STATUS & ENUM DEFINITIONS
 * Single source of truth for all status values in the ERP system.
 * These values MUST match the database CHECK constraints exactly.
 *
 * NEVER use raw strings for status values - import from this module instead.
 */

import { computeArStatus } from "./ar-status"

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
// DB: CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received', 'partially_received',
//           'received_with_issues'))
// ============================================================================
export const PO_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECEIVED: "received",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED_WITH_ISSUES: "received_with_issues",
} as const

export type POStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS]

export const PO_STATUS_VALUES: readonly POStatus[] = [
  PO_STATUS.DRAFT,
  PO_STATUS.PENDING,
  PO_STATUS.APPROVED,
  PO_STATUS.REJECTED,
  PO_STATUS.RECEIVED,
  PO_STATUS.PARTIALLY_RECEIVED,
  PO_STATUS.RECEIVED_WITH_ISSUES,
] as const

// ============================================================================
// SALES ORDERS
// DB: CHECK (status IN ('draft_quotation', 'pending_approval', 'approved_quotation', 'rejected_quotation',
//           'expired_quotation', 'draft', 'pending', 'pending_accountant', 'accountant_approved',
//           'ready_for_delivery', 'shipped', 'delivered', 'cancelled'))
// The *_quotation / pending_approval values belong to the legacy sales_orders.entity_type = 'quotation' model.
// ============================================================================
export const SO_STATUS = {
  DRAFT_QUOTATION: "draft_quotation",
  PENDING_APPROVAL: "pending_approval",
  APPROVED_QUOTATION: "approved_quotation",
  REJECTED_QUOTATION: "rejected_quotation",
  EXPIRED_QUOTATION: "expired_quotation",
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
  SO_STATUS.DRAFT_QUOTATION,
  SO_STATUS.PENDING_APPROVAL,
  SO_STATUS.APPROVED_QUOTATION,
  SO_STATUS.REJECTED_QUOTATION,
  SO_STATUS.EXPIRED_QUOTATION,
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
// DB: CHECK (status IN ('DRAFT', 'READY_FOR_SHIPMENT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY',
//           'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'))
// ============================================================================
export const DP_STATUS = {
  DRAFT: "DRAFT",
  READY_FOR_SHIPMENT: "READY_FOR_SHIPMENT",
  PRINTED: "PRINTED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  SUBMITTED_SIGNED: "SUBMITTED_SIGNED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const

export type DPStatus = (typeof DP_STATUS)[keyof typeof DP_STATUS]

// ============================================================================
// SALES QUOTATIONS
// DB: CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired'))
// ============================================================================
export const QUOTATION_STATUS = {
  DRAFT: "draft",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const

export type QuotationStatus = (typeof QUOTATION_STATUS)[keyof typeof QUOTATION_STATUS]

// ============================================================================
// GOODS RECEIPTS
// DB: CHECK (status IN ('pending', 'partial', 'complete', 'discrepancy'))
// ============================================================================
export const GRN_STATUS = {
  PENDING: "pending",
  PARTIAL: "partial",
  COMPLETE: "complete",
  DISCREPANCY: "discrepancy",
} as const

export type GRNStatus = (typeof GRN_STATUS)[keyof typeof GRN_STATUS]

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
 * Computes invoice status based on paid vs total amount (AR and AP share the same four DB values).
 * Delegates to lib/ar-status.ts, the single implementation. Returns DB-valid values only (partially_paid, NOT partial).
 */
export function computeInvoiceStatus(paidAmount: number, totalAmount: number, dueDate?: string | Date): APStatus {
  return computeArStatus({ amount: totalAmount, collectedAmount: paidAmount, dueDate })
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
