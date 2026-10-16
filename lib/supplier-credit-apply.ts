// FEAT-01: deducting supplier credits (raised by returned items) from a new purchase order.
//
// Lifecycle (existing supplier_credits columns only; no schema change):
//   PO created   -> each selected credit moves active -> used with used_in_po_id = the PO (guarded update).
//                   Using only part of a credit splits it: the used row keeps the used part, a new active row
//                   holds the remainder (same supplier, source invoice and reference), so the total never changes.
//   PO rejected / deleted (before any AP invoice) -> its credits go back to active.
//   PO approved  -> the AP invoice keeps the gross PO total; the reserved credits are its first "payment":
//                   paid_amount = credits, one supplier_payments row with method "supplier_credit".
//                   No balance_entries row is written: no cash moved.
//
// The selection, validation and reservation rules are shared with customer credits (lib/credit-apply.ts).
import type { WorkflowResult } from "./returns"
import { remainderNote } from "./supplier-credit-note"
import {
  CREDIT_TOLERANCE as TOLERANCE,
  SUPPLIER_CREDIT_LEDGER,
  appendCreditNote as appendNote,
  creditMoney as money,
  parseCreditSelections as parseSelections,
  reserveCredits,
  validateCredits,
  type CreditSelection,
} from "./credit-apply"

type Db = { from: (table: string) => any }

export type { CreditSelection }

export const SUPPLIER_CREDIT_PAYMENT_METHOD = "supplier_credit"

/** Parses the `credits` field of a PO POST. undefined/null/[] = no credits. */
export function parseCreditSelections(raw: unknown): { ok: true; selections: CreditSelection[] } | { ok: false; result: WorkflowResult } {
  return parseSelections(raw, SUPPLIER_CREDIT_LEDGER)
}

/** Read-only check before the PO is written: every credit is the supplier's, still active, and covers the amount. */
export async function validateCreditSelections(
  db: Db,
  input: { supplierId: number; poTotal: number; selections: CreditSelection[] },
): Promise<{ ok: true; rows: Map<number, any> } | { ok: false; result: WorkflowResult }> {
  return validateCredits(db, SUPPLIER_CREDIT_LEDGER, { ownerId: input.supplierId, limit: input.poTotal, selections: input.selections })
}

/**
 * Reserves the validated credits on the PO. Every step is a guarded write; on any failure the credits already
 * reserved by this call are put back, so the caller only has to remove the PO. Returns null on success.
 */
export async function reserveSupplierCredits(
  db: Db,
  input: { poId: number; poNumber: string; selections: CreditSelection[]; rows: Map<number, any> },
): Promise<WorkflowResult | null> {
  const { error } = await reserveCredits(db, SUPPLIER_CREDIT_LEDGER, {
    targetId: input.poId,
    targetNumber: input.poNumber,
    selections: input.selections,
    rows: input.rows,
  })
  return error
}

/** Puts the credits reserved on a PO back to active (PO rejected or deleted). Returns an error message or null. */
export async function releaseSupplierCredits(db: Db, poId: number, reason: string): Promise<string | null> {
  const { data: rows, error } = await db.from("supplier_credits").select("credit_id, notes").eq("used_in_po_id", poId).eq("status", "used")
  if (error) return error.message || "read failed"
  for (const row of rows || []) {
    const { error: updateError } = await db
      .from("supplier_credits")
      .update({ status: "active", used_at: null, used_in_po_id: null, notes: appendNote(row.notes, reason) })
      .eq("credit_id", row.credit_id)
      .eq("used_in_po_id", poId)
      .eq("status", "used")
    if (updateError) return updateError.message || "update failed"
  }
  return null
}

/**
 * After a PO's credits were released for good, fold each split remainder back into its credit, so the supplier card
 * shows one row again. Only a remainder that is still active and untouched (its note is exactly the one written at the
 * split) is folded. Best effort: a failure leaves two correct active rows (same total), never a lost amount.
 */
export async function mergeReleasedRemainders(db: Db, creditIds: number[], poNumber: string): Promise<void> {
  for (const creditId of creditIds) {
    const { data: rows } = await db.from("supplier_credits").select("*").eq("credit_id", creditId).eq("status", "active").limit(1)
    const credit = rows?.[0]
    if (!credit) continue
    const usedPart = money(Number(credit.amount) || 0)
    const note = remainderNote(creditId, usedPart, poNumber)
    const { data: remainders } = await db
      .from("supplier_credits")
      .select("*")
      .eq("supplier_id", credit.supplier_id)
      .eq("status", "active")
      .eq("notes", note)
      .limit(1)
    const remainder = remainders?.[0]
    if (!remainder) continue
    const { data: removed, error: removeError } = await db
      .from("supplier_credits")
      .delete()
      .eq("credit_id", remainder.credit_id)
      .eq("status", "active")
      .eq("notes", note)
      .select("credit_id")
    if (removeError || !removed || removed.length !== 1) continue
    const { data: grown, error: growError } = await db
      .from("supplier_credits")
      .update({ amount: money(usedPart + (Number(remainder.amount) || 0)) })
      .eq("credit_id", creditId)
      .eq("status", "active")
      .eq("amount", credit.amount)
      .select("credit_id")
    if (!growError && grown && grown.length === 1) continue
    // The credit changed in between: put the remainder back as it was so nothing is lost.
    const { credit_id: _dropId, ...restore } = remainder
    const { error: restoreError } = await db.from("supplier_credits").insert(restore)
    if (restoreError) console.error("Supplier credits: could not restore a remainder row", remainder, restoreError)
  }
}

/** Sum of the credits reserved on a PO (credits marked credited manually have no used_in_po_id and never count). */
export async function reservedCreditTotal(db: Db, poId: number): Promise<{ total: number; error: string | null }> {
  const { data, error } = await db.from("supplier_credits").select("amount").eq("used_in_po_id", poId).eq("status", "used")
  if (error) return { total: 0, error: error.message || "read failed" }
  return { total: money((data || []).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0)), error: null }
}

/** Invoice fields for an AP invoice of `amount` with `applied` credit already settled. */
export function creditedInvoiceFields(amount: number, applied: number) {
  const paid = money(Math.min(Math.max(applied, 0), money(amount)))
  const status = paid <= 0 ? "pending" : money(amount) - paid <= TOLERANCE ? "paid" : "partially_paid"
  return { paid_amount: paid, status }
}
