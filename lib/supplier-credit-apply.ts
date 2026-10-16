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
import type { WorkflowResult } from "./returns"
import { remainderNote } from "./supplier-credit-note"

type Db = { from: (table: string) => any }

export type CreditSelection = { creditId: number; amount: number }

export const SUPPLIER_CREDIT_PAYMENT_METHOD = "supplier_credit"
const MAX_SELECTIONS = 50
const TOLERANCE = 0.005
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const fail = (status: number, error: string, code: string, extra: Record<string, unknown> = {}): WorkflowResult => ({
  status,
  body: { error, code, ...extra },
})

/** Parses the `credits` field of a PO POST. undefined/null/[] = no credits. */
export function parseCreditSelections(raw: unknown): { ok: true; selections: CreditSelection[] } | { ok: false; result: WorkflowResult } {
  if (raw === undefined || raw === null) return { ok: true, selections: [] }
  const bad = (error: string) => ({ ok: false as const, result: fail(400, error, "CREDIT_INPUT_INVALID") })
  if (!Array.isArray(raw)) return bad("credits must be a list of { creditId, amount }")
  if (raw.length > MAX_SELECTIONS) return bad(`At most ${MAX_SELECTIONS} credits can be applied to one purchase order`)
  const selections: CreditSelection[] = []
  for (const entry of raw) {
    const creditId = Number(entry?.creditId ?? entry?.credit_id)
    const rawAmount = entry?.amount
    const amount = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" && /^\d+(\.\d+)?$/.test(rawAmount.trim()) ? Number(rawAmount) : NaN
    if (!Number.isSafeInteger(creditId) || creditId <= 0) return bad("Each credit needs a valid creditId")
    if (!Number.isFinite(amount) || money(amount) <= 0) return bad("Each credit amount must be greater than zero")
    if (selections.some((s) => s.creditId === creditId)) return bad("A credit can be listed only once")
    selections.push({ creditId, amount: money(amount) })
  }
  return { ok: true, selections }
}

/** Read-only check before the PO is written: every credit is the supplier's, still active, and covers the amount. */
export async function validateCreditSelections(
  db: Db,
  input: { supplierId: number; poTotal: number; selections: CreditSelection[] },
): Promise<{ ok: true; rows: Map<number, any> } | { ok: false; result: WorkflowResult }> {
  const rows = new Map<number, any>()
  if (input.selections.length === 0) return { ok: true, rows }
  const { data, error } = await db.from("supplier_credits").select("*").in("credit_id", input.selections.map((s) => s.creditId))
  if (error) return { ok: false, result: fail(500, "Could not read the supplier credits. Nothing was saved.", "CREDIT_READ_FAILED") }
  for (const row of data || []) rows.set(row.credit_id, row)
  for (const s of input.selections) {
    const row = rows.get(s.creditId)
    if (!row || row.status !== "active" || Number(row.supplier_id) !== Number(input.supplierId)) {
      return { ok: false, result: fail(409, `Credit #${s.creditId} is not an open credit of this supplier`, "CREDIT_NOT_AVAILABLE", { creditId: s.creditId }) }
    }
    if (s.amount > money(Number(row.amount)) + TOLERANCE) {
      return {
        ok: false,
        result: fail(409, `Credit #${s.creditId} has only ${money(Number(row.amount)).toFixed(2)} available`, "CREDIT_AMOUNT_INVALID", {
          creditId: s.creditId,
          available: money(Number(row.amount)),
        }),
      }
    }
  }
  const applied = money(input.selections.reduce((sum, s) => sum + s.amount, 0))
  if (applied > money(input.poTotal) + TOLERANCE) {
    return { ok: false, result: fail(409, `The credits (${applied.toFixed(2)}) are more than the purchase order total (${money(input.poTotal).toFixed(2)})`, "CREDIT_EXCEEDS_TOTAL", { applied, total: money(input.poTotal) }) }
  }
  return { ok: true, rows }
}

const appendNote = (notes: string | null | undefined, note: string) => (notes ? `${notes}; ${note}` : note)

/**
 * Reserves the validated credits on the PO. Every step is a guarded write; on any failure the credits already
 * reserved by this call are put back, so the caller only has to remove the PO. Returns null on success.
 */
export async function reserveSupplierCredits(
  db: Db,
  input: { poId: number; poNumber: string; selections: CreditSelection[]; rows: Map<number, any> },
): Promise<WorkflowResult | null> {
  const undo: (() => Promise<void>)[] = []
  const rollback = async () => {
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e: any) {
        console.error("[supplier-credit-apply] rollback step failed:", e?.message || e)
      }
    }
  }
  const now = new Date().toISOString()
  for (const s of input.selections) {
    const row = input.rows.get(s.creditId)
    const original = money(Number(row.amount))
    const remainder = money(original - s.amount)
    const split = remainder > TOLERANCE
    const { data: moved, error } = await db
      .from("supplier_credits")
      .update({
        status: "used",
        used_at: now,
        used_in_po_id: input.poId,
        amount: s.amount,
        notes: appendNote(row.notes, split ? `Applied ${s.amount.toFixed(2)} of ${original.toFixed(2)} to ${input.poNumber}` : `Applied to ${input.poNumber}`),
      })
      .eq("credit_id", s.creditId)
      .eq("status", "active")
      .eq("amount", row.amount)
      .select("credit_id")
    if (error) {
      await rollback()
      return fail(500, "Could not reserve the supplier credit. Nothing was saved.", "CREDIT_RESERVE_FAILED")
    }
    if (!moved || moved.length !== 1) {
      await rollback()
      return fail(409, `Credit #${s.creditId} was used or changed by someone else. Reload and try again.`, "CREDIT_NOT_AVAILABLE", { creditId: s.creditId })
    }
    const restore = async () => {
      await db
        .from("supplier_credits")
        .update({ status: "active", used_at: null, used_in_po_id: null, amount: row.amount, notes: row.notes ?? null })
        .eq("credit_id", s.creditId)
        .eq("used_in_po_id", input.poId)
    }
    undo.push(restore)
    if (split) {
      const { data: inserted, error: insertError } = await db
        .from("supplier_credits")
        .insert({
          supplier_id: row.supplier_id,
          amount: remainder,
          credit_type: row.credit_type ?? null,
          invoice_id: row.invoice_id ?? null,
          reference_id: row.reference_id ?? null,
          reference_type: row.reference_type ?? null,
          description: row.description ?? null,
          status: "active",
          used_at: null,
          used_in_po_id: null,
          created_at: row.created_at ?? undefined,
          created_by: row.created_by ?? null,
          notes: remainderNote(s.creditId, s.amount, input.poNumber),
        })
        .select("credit_id")
      if (insertError || !inserted || inserted.length !== 1) {
        await rollback()
        return fail(500, "Could not split the supplier credit. Nothing was saved.", "CREDIT_RESERVE_FAILED")
      }
      const remainderId = inserted[0].credit_id
      undo.push(async () => {
        await db.from("supplier_credits").delete().eq("credit_id", remainderId).eq("status", "active")
      })
    }
  }
  return null
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
