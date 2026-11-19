// Maintenance quick invoice (spec docs/superpowers/specs/2026-11-17-maintenance-quick-invoice-design.md, approach A).
//
// One call makes the same three records as invoice 10503: a small maintenance sales order whose lines are service
// (outsourced) lines typed by name, a delivery permit that is already APPROVED (no stock is taken: no product, no
// inventory rows), and the customer invoice from that permit through the normal workflow (createDpInvoices: normal
// invoice numbering, VAT, e-invoice lines). Printing, ETA send, credit notes, correct-and-reissue and payments then
// work unchanged.
//
// There is no database transaction: if a later step fails, the earlier records are deleted again (newest first), so
// nothing half-made is left. createDpInvoices already takes back its own invoice when it fails.
import { createDpInvoices, loadEtaGoLiveAt, round2, VAT_RATE } from "./invoicing"
import { etaLines, isAfterGoLive } from "./eta/totals"
import { buildSalesOrderPaymentFields } from "./payment-type"
import { highestSerial, insertWithNumber } from "./doc-number"
import { QUICK_SO_TYPE, QUICK_SO_NOTE, isMaintenanceNumber } from "./invoice-codes"

type Db = any

// moved to ./invoice-codes (lib/invoicing.ts uses them to pick the MINV code); re-exported for existing imports
export { QUICK_SO_TYPE, QUICK_SO_NOTE }
export const MAX_LINES = 50
export const MAX_NAME_LENGTH = 200

export interface QuickLine {
  name: string
  quantity: number
  /** price of one unit BEFORE VAT */
  unitPrice: number
}
export interface QuickInput {
  customerId: number
  lines: QuickLine[]
}
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const isPositive = (n: number) => Number.isFinite(n) && n > 0

/** The request body, checked: an existing customer's id and 1-50 lines, each with a name, a quantity and a price above 0. */
export function validateQuickInvoice(body: unknown): Checked<QuickInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Missing details" }
  const b = body as Record<string, unknown>
  const customerId = Number(b.customerId)
  if (!Number.isInteger(customerId) || customerId <= 0) return { ok: false, error: "Choose a customer" }
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { ok: false, error: "Add at least one line" }
  if (b.lines.length > MAX_LINES) return { ok: false, error: `At most ${MAX_LINES} lines` }
  const lines: QuickLine[] = []
  for (const [i, raw] of b.lines.entries()) {
    const line = (raw || {}) as Record<string, unknown>
    const name = String(line.name ?? "").replace(/\s+/g, " ").trim()
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    const n = i + 1
    if (!name) return { ok: false, error: `Line ${n}: enter what was done` }
    if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Line ${n}: the name can be at most ${MAX_NAME_LENGTH} characters` }
    if (!isPositive(quantity)) return { ok: false, error: `Line ${n}: the quantity must be above 0` }
    if (!isPositive(unitPrice)) return { ok: false, error: `Line ${n}: the price must be above 0` }
    lines.push({ name, quantity: Math.round(quantity * 1000) / 1000, unitPrice: round2(unitPrice) })
  }
  return { ok: true, value: { customerId, lines } }
}

export interface QuickTotals {
  net: number
  vat: number
  total: number
}

/**
 * The totals the invoice will carry: prices are before VAT and 14% VAT is added. After the e-invoice go-live VAT is
 * rounded per line (as the portal adds it up); before it, on the total (lib/invoicing.ts, unchanged rules).
 */
export function quickTotals(lines: QuickLine[], perLine = true): QuickTotals {
  if (perLine) {
    const { totals } = etaLines(lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })), 0)
    return { net: totals.net, vat: totals.vat, total: totals.total }
  }
  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  const total = round2(net * (1 + VAT_RATE))
  return { net, vat: round2(total - net), total }
}

/** Whether a customer invoice counts as maintenance (the Maintenance tab of Accounts Receivable). */
export function isMaintenanceInvoice(inv: {
  is_maintenance?: boolean | null
  invoice_number?: string | null
  so_type?: string | null
  so_notes?: string | null
}): boolean {
  if (inv.is_maintenance === true) return true
  // MINV numbers, and the work-order maintenance invoices (INV-MNT-, app/api/maintenance/invoices)
  if (isMaintenanceNumber(inv.invoice_number)) return true
  // a quick invoice made before accounts_receivable.is_maintenance exists (scripts/sql/2026-11-17-maintenance-role.sql)
  return inv.so_type === QUICK_SO_TYPE && String(inv.so_notes || "").startsWith(QUICK_SO_NOTE)
}

export interface QuickResult {
  status: number
  body: any
}
const fail = (status: number, error: string, extra: Record<string, any> = {}): QuickResult => ({ status, body: { error, ...extra } })
const today = () => new Date().toISOString().split("T")[0]

/** Delete what was made so far, newest first. Returns the steps that could not be undone (logged). */
async function undo(db: Db, made: { soId?: number; permitId?: number }): Promise<string[]> {
  const steps: [string, () => PromiseLike<any>][] = []
  if (made.permitId) {
    steps.push(["delivery permit items", () => db.from("delivery_permit_items").delete().eq("permit_id", made.permitId)])
    steps.push(["delivery permit", () => db.from("delivery_permits").delete().eq("permit_id", made.permitId)])
  }
  if (made.soId) {
    steps.push(["sales order items", () => db.from("sales_order_items").delete().eq("so_id", made.soId)])
    steps.push(["sales order", () => db.from("sales_orders").delete().eq("so_id", made.soId)])
  }
  const failed: string[] = []
  for (const [what, run] of steps) {
    const res = await run()
    if (res?.error) {
      failed.push(what)
      console.error(`[quick-invoice] UNDO FAILED (${what}) so=${made.soId} permit=${made.permitId}: ${res.error.message}. Manual review needed.`)
    }
  }
  return failed
}

const undone = async (db: Db, made: { soId?: number; permitId?: number }, result: QuickResult): Promise<QuickResult> => {
  const failed = await undo(db, made)
  if (failed.length === 0) return result
  return fail(500, `${result.body?.error || "Failed"} Some records could not be removed (${failed.join(", ")}); contact an administrator.`, {
    partialFailure: true,
  })
}

/** Order, approved permit and invoice in one go; any failure leaves nothing behind. */
export async function createQuickMaintenanceInvoice(db: Db, input: QuickInput): Promise<QuickResult> {
  const made: { soId?: number; permitId?: number } = {}
  try {
    const { data: customer, error: customerError } = await db
      .from("customers")
      .select("customer_id, customer_name")
      .eq("customer_id", input.customerId)
      .maybeSingle()
    if (customerError) return fail(500, `Could not read the customer: ${customerError.message}`)
    if (!customer) return fail(404, "Customer not found")

    // Price the order the way the invoice will be priced, so the invoice exactly fits the order.
    let goLive: string | null
    try {
      goLive = await loadEtaGoLiveAt(db)
    } catch (error: any) {
      return fail(503, `The e-invoice go-live setting could not be read (${error?.message || error}). Nothing was created; please try again.`)
    }
    const totals = quickTotals(input.lines, isAfterGoLive(new Date().toISOString(), goLive))
    const now = new Date().toISOString()
    const date = today()

    // 1. The sales order (already delivered: the work is done), service lines only.
    const nextSoNumber = async () => {
      const { data, error } = await db.rpc("generate_so_number")
      if (error) console.error("[quick-invoice] generate_so_number:", error.message)
      return error ? null : ((data as string) || null)
    }
    const so = await insertWithNumber<any>(null, nextSoNumber, (soNumber) =>
      db
        .from("sales_orders")
        .insert({
          so_number: soNumber,
          customer_id: input.customerId,
          entity_type: "sales_order",
          status: "delivered",
          fulfillment_status: "DELIVERED",
          so_type: QUICK_SO_TYPE,
          notes: QUICK_SO_NOTE,
          order_date: date,
          delivery_date: date,
          subtotal: totals.net,
          total: totals.total,
          net_total: totals.total,
          discount_type: "none",
          discount_value: 0,
          discount_amount: 0,
          ...buildSalesOrderPaymentFields("cash", {}),
          created_at: now,
          updated_at: now,
        })
        .select()
        .single(),
    )
    if (!so.ok) {
      const why = so.reason === "error" ? so.error?.message || String(so.error) : "no sales order number"
      return fail(500, `Could not create the maintenance order (${why}). Nothing was saved.`)
    }
    made.soId = so.data.so_id
    const soNumber: string = so.data.so_number

    const { error: soItemsError } = await db.from("sales_order_items").insert(
      input.lines.map((l) => ({
        so_id: made.soId,
        product_id: null,
        item_type: "outsourced",
        item_category: QUICK_SO_TYPE,
        outsourced_name: l.name,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        total: round2(l.quantity * l.unitPrice),
      })),
    )
    if (soItemsError) return await undone(db, made, fail(500, "Could not save the invoice lines. Nothing was saved."))

    // 2. The delivery permit, already approved; no product and no warehouse, so no stock moves.
    const year = new Date().getFullYear()
    let skip = 0
    const nextPermitNumber = async () => {
      const { data, error } = await db.from("delivery_permits").select("permit_no").like("permit_no", `DP-${year}-%`)
      if (error) return null
      const next = highestSerial((data || []).map((p: any) => p.permit_no), "DP", year) + 1 + skip++
      return `DP-${year}-${String(next).padStart(4, "0")}`
    }
    const permit = await insertWithNumber<any>(null, nextPermitNumber, (permitNo) =>
      db
        .from("delivery_permits")
        .insert({
          permit_no: permitNo,
          sales_order_id: made.soId,
          customer_id: input.customerId,
          recipient_name: customer.customer_name || null,
          status: "APPROVED",
          submitted_signed_at: now,
          approved_at: now,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single(),
    )
    if (!permit.ok) return await undone(db, made, fail(500, "Could not create the delivery permit. Nothing was saved."))
    made.permitId = permit.data.permit_id

    const { error: permitItemsError } = await db.from("delivery_permit_items").insert(
      input.lines.map((l) => ({
        permit_id: made.permitId,
        product_id: null,
        item_name_snapshot: l.name,
        quantity: l.quantity,
        allocated_quantity: l.quantity,
        unit_price: l.unitPrice,
        total: round2(l.quantity * l.unitPrice),
      })),
    )
    if (permitItemsError) return await undone(db, made, fail(500, "Could not save the delivery permit lines. Nothing was saved."))

    // 3. The invoice from that permit (normal numbering; takes itself back when it fails).
    const invoiced = await createDpInvoices(db, [made.permitId!])
    const invoice = invoiced.status === 200 ? invoiced.body?.invoices?.[0] : null
    if (!invoice) {
      const error = invoiced.body?.requiresSplit ? "The invoice could not be made in one piece." : invoiced.body?.error || "Could not create the invoice."
      return await undone(db, made, fail(invoiced.status === 200 ? 500 : invoiced.status, `${error} Nothing was saved.`))
    }

    // The maintenance flag. Without the column (SQL not applied yet) the order type and note still mark it.
    const { error: flagError } = await db.from("accounts_receivable").update({ is_maintenance: true }).eq("invoice_id", invoice.invoice_id)
    if (flagError) console.warn(`[quick-invoice] is_maintenance not set on invoice ${invoice.invoice_id}: ${flagError.message}`)

    return {
      status: 200,
      body: {
        success: true,
        invoiceId: invoice.invoice_id,
        invoiceNumber: invoice.invoice_number,
        amount: Number(invoice.amount),
        soId: made.soId,
        soNumber,
        permitId: made.permitId,
        permitNo: permit.data.permit_no,
        customerName: customer.customer_name,
      },
    }
  } catch (error: any) {
    console.error("[quick-invoice] failed:", error)
    return await undone(db, made, fail(500, `${error?.message || "Failed to create the invoice"}. Nothing was saved.`))
  }
}
