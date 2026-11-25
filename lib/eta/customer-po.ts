// The customer's purchase order number of a sales order (sales_orders.customer_po; owner request 2026-11-25).
// Optional. Typed when a quotation is approved into a sales order, or later in the invoice's e-invoice window; sent
// to the tax portal as purchaseOrderReference (lib/eta/document.ts) when not empty.
import { liveRealDocument } from "./live"

type Db = any

export const CUSTOMER_PO_MAX = 100

/** The typed value cleaned: trimmed, inner spaces collapsed; "" = none. Error when too long. */
export function cleanCustomerPo(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: "" }
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: "The customer's PO number must be text." }
  const value = String(raw).replace(/\s+/g, " ").trim()
  if (value.length > CUSTOMER_PO_MAX) return { ok: false, error: `The customer's PO number can be at most ${CUSTOMER_PO_MAX} characters.` }
  return { ok: true, value }
}

type Result = { ok: true; value: string } | { ok: false; status: number; code: string; error: string }

/** The sales orders an invoice bills: those of its delivery permits, else its own (as the e-invoice preview reads them). */
async function invoiceOrderIds(db: Db, invoice: { invoice_id: number; so_id: number | null }): Promise<number[]> {
  const links = await db.from("invoice_delivery_permits").select("permit_id").eq("invoice_id", invoice.invoice_id)
  if (links.error) throw new Error(links.error.message)
  if (!(links.data || []).length) return invoice.so_id ? [Number(invoice.so_id)] : []
  const permits = await db.from("delivery_permits").select("permit_id, sales_order_id").in("permit_id", links.data.map((l: any) => l.permit_id))
  if (permits.error) throw new Error(permits.error.message)
  return [...new Set((permits.data || []).map((p: any) => p.sales_order_id).filter((id: any) => id != null).map(Number))] as number[]
}

/** Saves the customer's PO number of one of the invoice's sales orders, from the e-invoice window. Refused once the invoice is on the portal. */
export async function saveCustomerPo(db: Db, invoiceId: number, soId: number, raw: unknown): Promise<Result> {
  const clean = cleanCustomerPo(raw)
  if (!clean.ok) return { ok: false, status: 400, code: "INVALID", error: clean.error }
  const { data: inv, error } = await db.from("accounts_receivable").select("invoice_id, so_id, status").eq("invoice_id", invoiceId).maybeSingle()
  if (error) return { ok: false, status: 500, code: "READ_FAILED", error: "Could not read the invoice." }
  if (!inv) return { ok: false, status: 404, code: "NOT_FOUND", error: "Invoice not found." }
  if (inv.status === "replaced") return { ok: false, status: 409, code: "REPLACED", error: "This invoice was replaced; use its new invoice instead." }
  if (inv.status === "cancelled") return { ok: false, status: 409, code: "CANCELLED", error: "This invoice was cancelled." }
  if (await liveRealDocument(db, invoiceId)) return { ok: false, status: 409, code: "ETA_LIVE", error: "This invoice is already on the portal; its PO number can't change." }
  if (!(await invoiceOrderIds(db, inv)).includes(soId)) return { ok: false, status: 400, code: "NOT_INVOICE_ORDER", error: "That sales order is not billed by this invoice." }
  const up = await db.from("sales_orders").update({ customer_po: clean.value || null }).eq("so_id", soId)
  if (up.error) return { ok: false, status: 500, code: "WRITE_FAILED", error: "Could not save the PO number." }
  return { ok: true, value: clean.value }
}

/** True when an invoice billing this sales order (directly, or through its delivery permits) is on the tax portal:
 *  then its PO number was sent there and must not change from the sales order's edit window either. */
export async function orderPoLocked(db: Db, soId: number): Promise<boolean> {
  const direct = await db.from("accounts_receivable").select("invoice_id").eq("so_id", soId)
  if (direct.error) throw new Error(direct.error.message)
  const ids = new Set<number>((direct.data || []).map((r: any) => Number(r.invoice_id)))
  const permits = await db.from("delivery_permits").select("permit_id").eq("sales_order_id", soId)
  if (permits.error) throw new Error(permits.error.message)
  if ((permits.data || []).length) {
    const links = await db.from("invoice_delivery_permits").select("invoice_id").in("permit_id", permits.data.map((p: any) => p.permit_id))
    if (links.error) throw new Error(links.error.message)
    for (const l of links.data || []) ids.add(Number(l.invoice_id))
  }
  for (const id of ids) if (await liveRealDocument(db, id)) return true
  return false
}

/**
 * The customer's PO number(s) of an invoice's sales orders, joined with ", " ("" when none), for the printed
 * invoice and the customer e-mail. Never throws: a database without the column, or a failed read, gives "".
 */
export async function invoiceCustomerPo(db: Db, invoice: { invoice_id: number; so_id: number | null }): Promise<string> {
  try {
    const ids = await invoiceOrderIds(db, invoice)
    if (!ids.length) return ""
    const r = await db.from("sales_orders").select("so_id, customer_po").in("so_id", ids)
    if (r.error) return ""
    const byId = new Map((r.data || []).map((o: any) => [Number(o.so_id), String(o.customer_po ?? "").trim()]))
    return [...new Set(ids.map((id) => byId.get(id) || "").filter(Boolean))].join(", ")
  } catch {
    return ""
  }
}
