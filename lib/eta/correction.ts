// Correct and reissue (spec §6.5a): which invoice is "open for correction", and the all-or-nothing reissue step.
// An open correction is a `replaced` invoice whose replaced_by_invoice_id is still empty: its sales order and
// delivery permits may be corrected, and the next invoice made from them is its reissue. Kept apart from ./send so
// invoicing, returns and the sales-order route don't load the signing code.
import { REPLACED_AR_STATUS } from "../ar-live"

type Db = any

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export interface OpenCorrection {
  invoiceId: number
  invoiceNumber: string | null
  customerId: number | null
  soId: number | null
  collected: number
  /** the permits linked to the old invoice (empty for a whole-order invoice) */
  permitIds: number[]
}

/** A row of accounts_receivable that is open for correction. */
export const isOpenCorrection = (row: { status?: string | null; replaced_by_invoice_id?: number | null } | null | undefined): boolean =>
  row?.status === REPLACED_AR_STATUS && (row.replaced_by_invoice_id ?? null) === null

const SELECT = "invoice_id, invoice_number, customer_id, so_id, status, collected_amount, replaced_by_invoice_id"

async function withLinks(db: Db, rows: any[]): Promise<OpenCorrection[]> {
  const open = rows.filter(isOpenCorrection)
  if (open.length === 0) return []
  const ids = open.map((r) => r.invoice_id)
  const links = must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("invoice_id", ids), "load correction links") as any[]
  return open
    .map((r) => ({
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number ?? null,
      customerId: r.customer_id ?? null,
      soId: r.so_id ?? null,
      collected: Number(r.collected_amount) || 0,
      permitIds: links.filter((l) => l.invoice_id === r.invoice_id).map((l) => Number(l.permit_id)),
    }))
    .sort((a, b) => a.invoiceId - b.invoiceId)
}

/** The open corrections of a sales order: on the order (so_id) or linked to one of its delivery permits. */
export async function openCorrectionsForOrder(db: Db, soId: number): Promise<OpenCorrection[]> {
  const bySo = must(
    await db.from("accounts_receivable").select(SELECT).eq("so_id", soId).eq("status", REPLACED_AR_STATUS),
    "load open corrections",
  ) as any[]
  const permits = must(await db.from("delivery_permits").select("permit_id").eq("sales_order_id", soId), "load delivery permits") as any[]
  const permitIds = permits.map((p) => p.permit_id)
  const links = permitIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id").in("permit_id", permitIds), "load invoice links") as any[])
    : []
  const linkedIds = [...new Set(links.map((l) => l.invoice_id))].filter((id) => !bySo.some((r) => r.invoice_id === id))
  const byLink = linkedIds.length
    ? (must(
        await db.from("accounts_receivable").select(SELECT).in("invoice_id", linkedIds).eq("status", REPLACED_AR_STATUS),
        "load linked open corrections",
      ) as any[])
    : []
  return withLinks(db, [...bySo, ...byLink])
}

/**
 * The open correction a delivery permit belongs to: the invoice linked to it, or (a whole-order invoice) the open
 * invoice of its sales order that has no permit links.
 */
export async function openCorrectionForPermit(db: Db, permitId: number): Promise<OpenCorrection | null> {
  const links = must(await db.from("invoice_delivery_permits").select("invoice_id").eq("permit_id", permitId), "load invoice link") as any[]
  if (links.length > 0) {
    const rows = must(await db.from("accounts_receivable").select(SELECT).in("invoice_id", links.map((l) => l.invoice_id)), "load linked invoice") as any[]
    return (await withLinks(db, rows))[0] || null
  }
  const permit = must(await db.from("delivery_permits").select("permit_id, sales_order_id").eq("permit_id", permitId).maybeSingle(), "load delivery permit")
  if (!permit?.sales_order_id) return null
  const rows = must(
    await db.from("accounts_receivable").select(SELECT).eq("so_id", permit.sales_order_id).eq("status", REPLACED_AR_STATUS),
    "load open corrections",
  ) as any[]
  return (await withLinks(db, rows)).find((c) => c.permitIds.length === 0) || null
}

/**
 * For a new delivery-permit invoice: the permits already invoiced elsewhere (`taken`), and the open corrections the
 * permits belong to (linked to an open correction, or on an order whose open whole-order invoice has no links).
 * A permit linked only to an open correction is available: the new invoice is its reissue.
 */
export async function correctionOfPermits(db: Db, permitIds: number[], soIds: number[]): Promise<{ taken: number[]; corrections: OpenCorrection[] }> {
  const links = permitIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("permit_id", permitIds), "check existing invoices") as any[])
    : []
  const linkedIds = [...new Set(links.map((l) => l.invoice_id))]
  const linkedRows = linkedIds.length
    ? (must(await db.from("accounts_receivable").select(SELECT).in("invoice_id", linkedIds), "load linked invoices") as any[])
    : []
  const openIds = new Set(linkedRows.filter(isOpenCorrection).map((r) => r.invoice_id))
  const taken = links.filter((l) => !openIds.has(l.invoice_id)).map((l) => Number(l.permit_id))
  const soRows = soIds.length
    ? (must(
        await db.from("accounts_receivable").select(SELECT).in("so_id", soIds).eq("status", REPLACED_AR_STATUS),
        "load open corrections",
      ) as any[])
    : []
  const all = await withLinks(db, [...linkedRows.filter((r) => openIds.has(r.invoice_id)), ...soRows.filter((r) => !openIds.has(r.invoice_id))])
  const corrections = all.filter((c) => openIds.has(c.invoiceId) || c.permitIds.length === 0)
  return { taken, corrections }
}

/**
 * The delivery permits of a sales order that belong to its open corrections (ruling P11): those linked to an open
 * correction, and - for an open whole-order invoice, which has no links - every permit of the order not invoiced elsewhere.
 */
export async function correctionPermitIds(db: Db, soId: number): Promise<number[]> {
  const corrections = await openCorrectionsForOrder(db, soId)
  if (corrections.length === 0) return []
  const ids = new Set(corrections.flatMap((c) => c.permitIds))
  if (corrections.some((c) => c.permitIds.length === 0)) {
    const permits = must(await db.from("delivery_permits").select("permit_id").eq("sales_order_id", soId), "load delivery permits") as any[]
    const all = permits.map((p) => Number(p.permit_id))
    const links = all.length ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("permit_id", all), "load invoice links") as any[]) : []
    const open = new Set(corrections.map((c) => c.invoiceId))
    for (const id of all) if (!links.some((l) => Number(l.permit_id) === id && !open.has(l.invoice_id))) ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}

export interface OrderCorrectionScope {
  /** the permits of the order's open corrections: only lines that sit on these (or on no permit) may change */
  permitIds: number[]
  /** the order's other invoices that still count (not replaced): while there is one, the customer can't change */
  liveInvoiceNumbers: string[]
}

/** What a sales-order edit may touch while the order has an open correction (ruling P15); null without one. */
export async function orderCorrectionScope(db: Db, soId: number): Promise<OrderCorrectionScope | null> {
  const permitIds = await correctionPermitIds(db, soId)
  const corrections = await openCorrectionsForOrder(db, soId)
  if (corrections.length === 0) return null
  const permits = must(await db.from("delivery_permits").select("permit_id").eq("sales_order_id", soId), "load delivery permits") as any[]
  const all = permits.map((p) => Number(p.permit_id))
  const links = all.length ? (must(await db.from("invoice_delivery_permits").select("invoice_id").in("permit_id", all), "load invoice links") as any[]) : []
  const bySo = must(await db.from("accounts_receivable").select("invoice_id, invoice_number, status").eq("so_id", soId), "load order invoices") as any[]
  const linkedIds = [...new Set(links.map((l) => l.invoice_id))].filter((id) => !bySo.some((r) => r.invoice_id === id))
  const byLink = linkedIds.length
    ? (must(await db.from("accounts_receivable").select("invoice_id, invoice_number, status").in("invoice_id", linkedIds), "load linked invoices") as any[])
    : []
  const live = [...bySo, ...byLink].filter((r) => r.status !== REPLACED_AR_STATUS)
  return { permitIds, liveInvoiceNumbers: live.map((r) => r.invoice_number || `#${r.invoice_id}`) }
}

/** Spec interface: the open correction (its old invoice) of a sales order or a delivery permit, or null. */
export async function openCorrection(db: Db, by: { soId?: number; permitId?: number }): Promise<{ oldInvoiceId: number } | null> {
  if (by.permitId) {
    const c = await openCorrectionForPermit(db, by.permitId)
    return c ? { oldInvoiceId: c.invoiceId } : null
  }
  if (by.soId) {
    const c = (await openCorrectionsForOrder(db, by.soId))[0]
    return c ? { oldInvoiceId: c.invoiceId } : null
  }
  return null
}

// ---- the reissue step (scripts/sql/2026-11-15-eta-step2.sql eta_reissue_invoice / eta_undo_reissue) ----

export const PAYMENTS_OTHER_CUSTOMER = "PAYMENTS_OTHER_CUSTOMER"
export const REISSUE_OVERPAID = "REISSUE_OVERPAID"

/** "This invoice has payments from {customer}. Move or refund them first" (spec §6.5a), in English and Arabic. */
export const paymentsOtherCustomerMessage = (customer: string) => ({
  message: `This invoice has payments from ${customer}. Move or refund them first`,
  messageAr: `على هذه الفاتورة مدفوعات من ${customer}. انقلها إلى العميل الصحيح أو ردّها أولاً`,
})

/** Arabic for the database function's refusals shown to the accountant. */
const REISSUE_MESSAGES_AR: Record<string, string> = {
  REISSUE_RETURN_CREDIT_USED: "تم استخدام رصيد دائن ناتج عن مرتجع من هذه الفاتورة. ألغِ استخدامه أولاً.",
  REISSUE_MISSING_PERMITS: "يجب أن تشمل الفاتورة الجديدة كل أذون التسليم الخاصة بالفاتورة القديمة.",
  REISSUE_OVERPAID: "المدفوعات أكبر من الفاتورة الجديدة. أكّد لحفظ الفرق رصيداً دائناً للعميل.",
  REISSUE_NOT_OPEN: "الفاتورة ليست قيد التصحيح.",
  REISSUE_PERMIT_TAKEN: "أحد أذون التسليم مفوتر بالفعل.",
}

export class ReissueRefused extends Error {
  constructor(readonly code: string, message: string, readonly messageAr?: string) {
    super(message)
  }
}
export class ReissueNumberTaken extends Error {}

/**
 * Creates the reissue of `oldInvoiceId` in one database transaction: the new invoice row (`row`, priced by the caller as
 * a normal invoice, with its invoice_number), links both ways, moves the permit links of `permitIds`, the payments,
 * schedules, used credits and collected amount, and keeps any excess as customer credit (only with confirmOverpaid).
 * Throws ReissueNumberTaken when the number is taken, ReissueRefused for the function's refusals.
 */
export async function reissueInvoice(
  db: Db,
  oldInvoiceId: number,
  row: Record<string, any>,
  permitIds: number[],
  confirmOverpaid: boolean,
): Promise<Record<string, any>> {
  const { data, error } = await db.rpc("eta_reissue_invoice", {
    p_old: oldInvoiceId,
    p_new_row: row,
    p_permit_ids: permitIds,
    p_confirm_overpaid: confirmOverpaid,
  })
  if (error?.code === "23505") throw new ReissueNumberTaken(String(row.invoice_number))
  if (error) {
    const code = String(error.hint || "")
    if (code === PAYMENTS_OTHER_CUSTOMER) {
      const name = /payments from (.*)\. Move or refund/.exec(String(error.message || ""))?.[1] || "another customer"
      const text = paymentsOtherCustomerMessage(name)
      throw new ReissueRefused(code, text.message, text.messageAr)
    }
    if (code.startsWith("REISSUE_")) throw new ReissueRefused(code, String(error.message), REISSUE_MESSAGES_AR[code])
    throw new Error(`reissue invoice: ${error.message || error}`)
  }
  const id = Number(Array.isArray(data) ? data[0] : data)
  if (!Number.isInteger(id) || id < 1) throw new Error("reissue invoice: no invoice id returned")
  const created = must(await db.from("accounts_receivable").select("*").eq("invoice_id", id).maybeSingle(), "load the new invoice")
  if (!created) throw new Error(`reissue invoice: invoice ${id} not found after it was created`)
  return created
}

/** Puts a just-made reissue back (the over-invoicing re-check found a concurrent invoice that came first). */
export async function undoReissue(db: Db, newInvoiceId: number, movedPermitIds: number[]): Promise<boolean> {
  const { error } = await db.rpc("eta_undo_reissue", { p_new: newInvoiceId, p_moved_permit_ids: movedPermitIds })
  if (error) {
    console.error(`[reissue] UNDO FAILED for invoice ${newInvoiceId}: ${error.message || error}. Manual review needed.`)
    return false
  }
  return true
}

/** The open corrections of approved permits, permit id -> the old invoice's number (the permits list marks them). One cheap look first: usually nothing is open. */
export async function openCorrectionsByPermit(db: Db, permitIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  const open = must(await db.from("accounts_receivable").select("invoice_id").eq("status", REPLACED_AR_STATUS).is("replaced_by_invoice_id", null), "load open corrections") as any[]
  if (open.length === 0) return out
  for (const id of permitIds) {
    const found = await openCorrectionForPermit(db, id)
    if (found) out.set(id, found.invoiceNumber)
  }
  return out
}
