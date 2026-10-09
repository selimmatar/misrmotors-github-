// Manual "mark as credited" for supplier credits raised by returned items.
// A credit goes active -> used (the existing status/used_at columns; no schema change). It is a status flag only:
// it does not touch accounts_payable, supplier_payments, balance_entries or inventory.
// Each row is moved with a guarded update (status must still be 'active'), so a repeated or concurrent request can
// never mark the same credit twice.
import { WorkflowResult } from "./returns"

type Db = { from: (table: string) => any }

export const MAX_CREDITS_PER_REQUEST = 200
const MANUAL_NOTE = "Marked credited manually"

const fail = (status: number, message: string, extra: Record<string, any> = {}): WorkflowResult => ({ status, body: { message, ...extra } })

function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CREDITS_PER_REQUEST) return null
  const ids: number[] = []
  for (const v of raw) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v.trim()) ? Number(v.trim()) : NaN
    if (!Number.isSafeInteger(n) || n <= 0) return null
    if (!ids.includes(n)) ids.push(n)
  }
  return ids
}

export async function markSupplierCreditsCredited(db: Db, input: any): Promise<WorkflowResult> {
  const ids = parseIds(input?.creditIds)
  if (!ids) return fail(400, `creditIds must be a list of 1 to ${MAX_CREDITS_PER_REQUEST} positive integer credit ids`)
  try {
    const found = await db.from("supplier_credits").select("credit_id, status, notes").in("credit_id", ids)
    if (found.error) throw new Error(found.error.message)
    const rows: any[] = found.data || []
    const known = new Set(rows.map((r) => r.credit_id))
    const missing = ids.filter((id) => !known.has(id))
    if (rows.length === 0) return fail(404, "Supplier credit not found", { missing })

    const now = new Date().toISOString()
    const updated: number[] = []
    const skipped: number[] = []
    for (const row of rows) {
      if (row.status !== "active") {
        skipped.push(row.credit_id)
        continue
      }
      const notes = row.notes ? `${row.notes}; ${MANUAL_NOTE}` : MANUAL_NOTE
      const res = await db
        .from("supplier_credits")
        .update({ status: "used", used_at: now, notes })
        .eq("credit_id", row.credit_id)
        .eq("status", "active")
        .select("credit_id")
      if (res.error) throw new Error(res.error.message)
      if ((res.data || []).length > 0) updated.push(row.credit_id)
      else skipped.push(row.credit_id) // lost a race: someone else already moved it
    }
    if (updated.length === 0) return fail(409, "These credits are already marked as credited. Nothing was changed.", { code: "CREDIT_ALREADY_CREDITED", skipped, missing })
    return { status: 200, body: { message: `${updated.length} credit(s) marked as credited`, updated, skipped, missing } }
  } catch (error: any) {
    console.error("[supplier-credits] mark credited error:", error?.message || error)
    return fail(500, "Failed to mark the credits as credited. Nothing further was changed.")
  }
}
