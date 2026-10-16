// Shared core for applying credits (supplier credits on a purchase order, customer credits on an AR invoice). Only
// the table, its owner and "used in" columns and the wording differ; the rules are the same:
//   - each selected credit moves active -> used, guarded on status 'active' AND the amount that was read;
//   - using only part of a credit splits it: the used row keeps the used part, a new active row holds the remainder
//     (same owner, source invoice and reference, note from ./supplier-credit-note), so the total never changes;
//   - on any failure the credits already moved by the call are put back.
import type { WorkflowResult } from "./returns"
import { remainderNote } from "./supplier-credit-note"

type Db = { from: (table: string) => any }

export type CreditSelection = { creditId: number; amount: number }

/** customer_payments.payment_method of a customer credit used on an invoice: not cash, never counted as cash paid */
export const CUSTOMER_CREDIT_PAYMENT_METHOD = "customer_credit"

export type CreditLedger = {
  table: string
  ownerColumn: string
  usedInColumn: string
  /** "supplier" / "customer", used in messages */
  owner: string
  /** "purchase order" / "invoice", used in messages */
  target: string
  /** what the credits may not exceed, e.g. "the purchase order total" */
  limitLabel: string
}

export const SUPPLIER_CREDIT_LEDGER: CreditLedger = {
  table: "supplier_credits",
  ownerColumn: "supplier_id",
  usedInColumn: "used_in_po_id",
  owner: "supplier",
  target: "purchase order",
  limitLabel: "the purchase order total",
}

export const CUSTOMER_CREDIT_LEDGER: CreditLedger = {
  table: "customer_credits",
  ownerColumn: "customer_id",
  usedInColumn: "used_in_invoice_id",
  owner: "customer",
  target: "invoice",
  limitLabel: "the invoice's remaining balance",
}

const MAX_SELECTIONS = 50
export const CREDIT_TOLERANCE = 0.005
const TOLERANCE = CREDIT_TOLERANCE
export const creditMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const money = creditMoney

const fail = (status: number, error: string, code: string, extra: Record<string, unknown> = {}): WorkflowResult => ({
  status,
  body: { error, code, ...extra },
})

/** Parses a `credits` field. undefined/null/[] = no credits. */
export function parseCreditSelections(
  raw: unknown,
  ledger: CreditLedger = SUPPLIER_CREDIT_LEDGER,
): { ok: true; selections: CreditSelection[] } | { ok: false; result: WorkflowResult } {
  if (raw === undefined || raw === null) return { ok: true, selections: [] }
  const bad = (error: string) => ({ ok: false as const, result: fail(400, error, "CREDIT_INPUT_INVALID") })
  if (!Array.isArray(raw)) return bad("credits must be a list of { creditId, amount }")
  if (raw.length > MAX_SELECTIONS) return bad(`At most ${MAX_SELECTIONS} credits can be applied to one ${ledger.target}`)
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

/** Read-only check before anything is written: every credit is the owner's, still active, and covers the amount. */
export async function validateCredits(
  db: Db,
  ledger: CreditLedger,
  input: { ownerId: number; limit: number; selections: CreditSelection[] },
): Promise<{ ok: true; rows: Map<number, any> } | { ok: false; result: WorkflowResult }> {
  const rows = new Map<number, any>()
  if (input.selections.length === 0) return { ok: true, rows }
  const { data, error } = await db.from(ledger.table).select("*").in("credit_id", input.selections.map((s) => s.creditId))
  if (error) return { ok: false, result: fail(500, `Could not read the ${ledger.owner} credits. Nothing was saved.`, "CREDIT_READ_FAILED") }
  for (const row of data || []) rows.set(row.credit_id, row)
  for (const s of input.selections) {
    const row = rows.get(s.creditId)
    if (!row || row.status !== "active" || Number(row[ledger.ownerColumn]) !== Number(input.ownerId)) {
      return { ok: false, result: fail(409, `Credit #${s.creditId} is not an open credit of this ${ledger.owner}`, "CREDIT_NOT_AVAILABLE", { creditId: s.creditId }) }
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
  if (applied > money(input.limit) + TOLERANCE) {
    return { ok: false, result: fail(409, `The credits (${applied.toFixed(2)}) are more than ${ledger.limitLabel} (${money(input.limit).toFixed(2)})`, "CREDIT_EXCEEDS_TOTAL", { applied, total: money(input.limit) }) }
  }
  return { ok: true, rows }
}

export const appendCreditNote = (notes: string | null | undefined, note: string) => (notes ? `${notes}; ${note}` : note)

/**
 * Moves the validated credits onto the target (PO or invoice). Every step is a guarded write; on any failure the
 * credits already moved by this call are put back. On success `undo` puts them back too (for a caller whose own
 * later step fails).
 */
export async function reserveCredits(
  db: Db,
  ledger: CreditLedger,
  input: { targetId: number; targetNumber: string; selections: CreditSelection[]; rows: Map<number, any> },
): Promise<{ error: WorkflowResult | null; undo: () => Promise<void> }> {
  const undo: (() => Promise<void>)[] = []
  const rollback = async () => {
    for (const step of [...undo].reverse()) {
      try {
        await step()
      } catch (e: any) {
        console.error(`[credit-apply] ${ledger.table} rollback step failed:`, e?.message || e)
      }
    }
  }
  const failed = async (result: WorkflowResult) => {
    await rollback()
    return { error: result, undo: async () => {} }
  }
  const now = new Date().toISOString()
  for (const s of input.selections) {
    const row = input.rows.get(s.creditId)
    const original = money(Number(row.amount))
    const remainder = money(original - s.amount)
    const split = remainder > TOLERANCE
    const { data: moved, error } = await db
      .from(ledger.table)
      .update({
        status: "used",
        used_at: now,
        [ledger.usedInColumn]: input.targetId,
        amount: s.amount,
        notes: appendCreditNote(row.notes, split ? `Applied ${s.amount.toFixed(2)} of ${original.toFixed(2)} to ${input.targetNumber}` : `Applied to ${input.targetNumber}`),
      })
      .eq("credit_id", s.creditId)
      .eq("status", "active")
      .eq("amount", row.amount)
      .select("credit_id")
    if (error) return failed(fail(500, `Could not reserve the ${ledger.owner} credit. Nothing was saved.`, "CREDIT_RESERVE_FAILED"))
    if (!moved || moved.length !== 1) {
      return failed(fail(409, `Credit #${s.creditId} was used or changed by someone else. Reload and try again.`, "CREDIT_NOT_AVAILABLE", { creditId: s.creditId }))
    }
    undo.push(async () => {
      await db
        .from(ledger.table)
        .update({ status: "active", used_at: null, [ledger.usedInColumn]: null, amount: row.amount, notes: row.notes ?? null })
        .eq("credit_id", s.creditId)
        .eq(ledger.usedInColumn, input.targetId)
    })
    if (split) {
      const { data: inserted, error: insertError } = await db
        .from(ledger.table)
        .insert({
          [ledger.ownerColumn]: row[ledger.ownerColumn],
          amount: remainder,
          credit_type: row.credit_type ?? null,
          invoice_id: row.invoice_id ?? null,
          reference_id: row.reference_id ?? null,
          reference_type: row.reference_type ?? null,
          description: row.description ?? null,
          status: "active",
          used_at: null,
          [ledger.usedInColumn]: null,
          created_at: row.created_at ?? undefined,
          created_by: row.created_by ?? null,
          notes: remainderNote(s.creditId, s.amount, input.targetNumber),
        })
        .select("credit_id")
      if (insertError || !inserted || inserted.length !== 1) {
        return failed(fail(500, `Could not split the ${ledger.owner} credit. Nothing was saved.`, "CREDIT_RESERVE_FAILED"))
      }
      const remainderId = inserted[0].credit_id
      undo.push(async () => {
        await db.from(ledger.table).delete().eq("credit_id", remainderId).eq("status", "active")
      })
    }
  }
  return { error: null, undo: rollback }
}
