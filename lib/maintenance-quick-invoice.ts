// Maintenance quick invoice (spec docs/superpowers/specs/2026-11-17-maintenance-quick-invoice-design.md, approach A).
//
// Since 2026-11-19 a MINV invoice stands on its own: it is linked to the customer only (tax ID, customer card), with
// no sales order and no delivery permit. Its lines are stored in ar_invoice_lines (createStandaloneMinv).
// Quick invoices made earlier through a maintenance sales order still work as before.
import { createStandaloneMinv, loadEtaGoLiveAt, round2, VAT_RATE } from "./invoicing"
import { etaLines, isAfterGoLive } from "./eta/totals"
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
  /** A carbon booklet page number (checked by the photo review route); without it the next MINV number is used. */
  invoiceNumber?: string | null
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

/** The MINV invoice on its own: linked to the customer only, no sales order and no delivery permit. */
export async function createQuickMaintenanceInvoice(db: Db, input: QuickInput): Promise<QuickResult> {
  try {
    const { data: customer, error: customerError } = await db
      .from("customers")
      .select("customer_id, customer_name")
      .eq("customer_id", input.customerId)
      .maybeSingle()
    if (customerError) return fail(500, `Could not read the customer: ${customerError.message}`)
    if (!customer) return fail(404, "Customer not found")

    let goLive: string | null
    try {
      goLive = await loadEtaGoLiveAt(db)
    } catch (error: any) {
      return fail(503, `The e-invoice go-live setting could not be read (${error?.message || error}). Nothing was created; please try again.`)
    }
    const totals = quickTotals(input.lines, isAfterGoLive(new Date().toISOString(), goLive))

    const created = await createStandaloneMinv(db, {
      customerId: input.customerId,
      amount: totals.total,
      manualNumber: input.invoiceNumber ?? null,
      lines: input.lines.map((l) => ({ description: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
    })
    if (created.status !== 200) return fail(created.status, `${created.body?.error || "Could not create the invoice."} Nothing was saved.`, created.body?.code ? { code: created.body.code } : {})
    const invoice = created.body

    return {
      status: 200,
      body: {
        success: true,
        invoiceId: invoice.invoice_id,
        invoiceNumber: invoice.invoice_number,
        amount: Number(invoice.amount),
        soId: null,
        soNumber: null,
        customerName: customer.customer_name,
      },
    }
  } catch (error: any) {
    console.error("[quick-invoice] failed:", error)
    return fail(500, `${error?.message || "Failed to create the invoice"}. Nothing was saved.`)
  }
}
