// Invoice generation (Batch 1B).
//
// Two supported workflows, never both for the same sales order:
//   A. Sales order -> invoice : one invoice for the WHOLE sales order (accounts_receivable.so_id, no DP links).
//   B. Delivery permit -> invoice : an invoice for only the items on the selected APPROVED delivery permit(s)
//      (linked through invoice_delivery_permits). A sales order may have many such invoices as long as the
//      cumulative invoiced quantity and value never exceed the sales order.
//
// Concurrency note: there is no database transaction here (no RPC/trigger/constraint was added). The only
// DB-enforced guard is UNIQUE(permit_id) on invoice_delivery_permits. Everything else is checked before the
// insert, then re-checked after it with a deterministic rule: among conflicting invoices the one with the
// LOWEST invoice_id survives; a higher-id invoice rolls itself back. See createSoInvoice/createDpInvoices.

import { resolveInstallmentCount } from "./payment-type"

export const VAT_RATE = 0.14
// Rounding slack when comparing cumulative invoiced value with the sales order total.
export const MONEY_TOLERANCE = 0.05
const QTY_EPSILON = 1e-6
const MAX_NUMBER_ATTEMPTS = 4

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

// Value of a set of items (pre-discount, pre-VAT `rawItemsTotal`) once the sales order's discount rate and
// 14% VAT are applied. This is the existing rule from create-from-dps, unchanged.
export function netInvoiceValue(rawItemsTotal: number, soSubtotal: number, soDiscountAmount: number) {
  const discountRate = soSubtotal > 0 ? soDiscountAmount / soSubtotal : 0
  return rawItemsTotal * (1 - discountRate) * (1 + VAT_RATE)
}
// The stored invoice amount, and what the invoice document prints, for a delivery-permit invoice.
export const computeInvoiceAmount = (rawItemsTotal: number, soSubtotal: number, soDiscountAmount: number) =>
  round2(netInvoiceValue(rawItemsTotal, soSubtotal, soDiscountAmount))

export const itemRawTotal = (item: { total?: any; quantity?: any; unit_price?: any }) =>
  item.total != null ? Number(item.total) : Number(item.quantity || 0) * Number(item.unit_price || 0)

// Same line matching as isSOFullyDelivered in the delivery-permits route: by product, else by name.
export const lineKey = (productId: number | null | undefined, name: string | null | undefined) =>
  productId ? `p:${productId}` : `n:${(name || "").trim()}`

// ---------------------------------------------------------------------------------------------------------
// Pure rules (no I/O) - unit tested
// ---------------------------------------------------------------------------------------------------------

export interface DpItem {
  product_id: number | null
  item_name_snapshot: string | null
  quantity: number
  unit_price?: number
  total?: number | null
}
export interface SoInvoicingState {
  so: {
    so_id: number
    so_number?: string
    customer_id?: number | null
    total: number
    subtotal: number
    discount_amount: number
    payment_type?: string | null
    payment_terms?: string | null
    installments?: number | null
  }
  soItems: { product_id: number | null; outsourced_name: string | null; quantity: number }[]
  /** every delivery permit of this sales order */
  permits: { permit_id: number; permit_no?: string; status: string; items: DpItem[] }[]
  /** every invoice attributable to this sales order (so_id = SO, or linked to one of its DPs) */
  invoices: { invoice_id: number; invoice_number?: string; so_id: number | null; amount: number; permit_ids: number[] }[]
}

export type Verdict = { ok: true; newValue?: number } | { ok: false; status: number; error: string }

const isSoLevelInvoice = (inv: SoInvoicingState["invoices"][number]) => inv.permit_ids.length === 0
const ownPermitIds = (state: SoInvoicingState) => new Set(state.permits.map((p) => p.permit_id))

// How much of an invoice counts against THIS sales order. A normal invoice counts in full; an invoice that
// also covers other sales orders' permits counts only for this order's permits.
function invoiceShare(state: SoInvoicingState, inv: SoInvoicingState["invoices"][number]) {
  const own = ownPermitIds(state)
  if (inv.permit_ids.length > 0 && inv.permit_ids.some((id) => !own.has(id))) {
    const raw = state.permits
      .filter((p) => inv.permit_ids.includes(p.permit_id))
      .reduce((sum, p) => sum + p.items.reduce((s, it) => s + itemRawTotal(it), 0), 0)
    return netInvoiceValue(raw, state.so.subtotal, state.so.discount_amount)
  }
  return Number(inv.amount) || 0
}

function orderedByKey(state: SoInvoicingState) {
  const map = new Map<string, number>()
  for (const line of state.soItems) {
    const key = lineKey(line.product_id, line.outsourced_name)
    map.set(key, (map.get(key) || 0) + (Number(line.quantity) || 0))
  }
  return map
}

function invoicedQtyByKey(state: SoInvoicingState, invoices: SoInvoicingState["invoices"]) {
  const map = new Map<string, number>()
  const own = ownPermitIds(state)
  for (const inv of invoices) {
    for (const permitId of inv.permit_ids) {
      if (!own.has(permitId)) continue
      const permit = state.permits.find((p) => p.permit_id === permitId)
      for (const item of permit?.items || []) {
        const key = lineKey(item.product_id, item.item_name_snapshot)
        map.set(key, (map.get(key) || 0) + (Number(item.quantity) || 0))
      }
    }
  }
  return map
}

const soLabel = (state: SoInvoicingState) => state.so.so_number || `#${state.so.so_id}`
const invoiceLabels = (invs: SoInvoicingState["invoices"]) => invs.map((i) => i.invoice_number || `#${i.invoice_id}`).join(", ")

// Workflow A guard: a whole-order invoice is only allowed while NOTHING has been invoiced against the order.
export function evaluateSoInvoice(state: SoInvoicingState): Verdict {
  if (state.invoices.length === 0) return { ok: true }
  const viaDps = state.invoices.filter((i) => !isSoLevelInvoice(i))
  if (viaDps.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Sales order ${soLabel(state)} is already being invoiced through delivery permits (${invoiceLabels(viaDps)}). Invoice the remaining items through their delivery permits.`,
    }
  }
  return {
    ok: false,
    status: 409,
    error: `Sales order ${soLabel(state)} has already been invoiced (${invoiceLabels(state.invoices)}).`,
  }
}

// Workflow B guard for the permits `newPermitIds` (all belonging to this sales order).
export function evaluateDpInvoice(state: SoInvoicingState, newPermitIds: number[]): Verdict {
  const full = state.invoices.filter(isSoLevelInvoice)
  if (full.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Sales order ${soLabel(state)} has already been invoiced in full (${invoiceLabels(full)}); its delivery permits cannot be invoiced again.`,
    }
  }

  const newPermits = state.permits.filter((p) => newPermitIds.includes(p.permit_id))
  const ordered = orderedByKey(state)
  const prior = invoicedQtyByKey(state, state.invoices)

  const requested = new Map<string, { qty: number; name: string }>()
  for (const permit of newPermits) {
    for (const item of permit.items) {
      const key = lineKey(item.product_id, item.item_name_snapshot)
      const entry = requested.get(key) || { qty: 0, name: item.item_name_snapshot || key }
      entry.qty += Number(item.quantity) || 0
      requested.set(key, entry)
    }
  }
  for (const [key, { qty, name }] of requested) {
    const orderedQty = ordered.get(key)
    if (orderedQty === undefined) {
      return { ok: false, status: 409, error: `"${name}" is not an item on sales order ${soLabel(state)} and cannot be invoiced against it.` }
    }
    const already = prior.get(key) || 0
    if (already + qty > orderedQty + QTY_EPSILON) {
      return {
        ok: false,
        status: 409,
        error: `"${name}": ${qty} requested, but only ${Math.max(orderedQty - already, 0)} of ${orderedQty} ordered remain to be invoiced on sales order ${soLabel(state)}.`,
      }
    }
  }

  const priorValue = state.invoices.reduce((sum, inv) => sum + invoiceShare(state, inv), 0)
  const newValue = newPermits.reduce(
    (sum, p) => sum + netInvoiceValue(p.items.reduce((s, it) => s + itemRawTotal(it), 0), state.so.subtotal, state.so.discount_amount),
    0,
  )
  if (priorValue + newValue > Number(state.so.total) + MONEY_TOLERANCE) {
    return {
      ok: false,
      status: 409,
      error: `Invoicing ${round2(newValue)} would exceed sales order ${soLabel(state)} (total ${round2(Number(state.so.total))}, already invoiced ${round2(priorValue)}).`,
    }
  }
  return { ok: true, newValue }
}

// Post-insert safety net. `myInvoiceId` is the invoice this request just created. Only invoices with an id
// LOWER than mine can displace me, so of any set of racing requests the lowest id always survives.
export function evaluateAfterInsert(state: SoInvoicingState, myInvoiceId: number): Verdict {
  const mine = state.invoices.find((i) => i.invoice_id === myInvoiceId)
  const earlier = state.invoices.filter((i) => i.invoice_id < myInvoiceId)
  const considered = state.invoices.filter((i) => i.invoice_id <= myInvoiceId)

  if (mine && isSoLevelInvoice(mine) && earlier.length > 0) {
    return { ok: false, status: 409, error: `Sales order ${soLabel(state)} was invoiced at the same time by another request (${invoiceLabels(earlier)}).` }
  }
  const earlierFull = earlier.filter(isSoLevelInvoice)
  if (earlierFull.length > 0) {
    return { ok: false, status: 409, error: `Sales order ${soLabel(state)} was invoiced in full at the same time (${invoiceLabels(earlierFull)}).` }
  }
  const ordered = orderedByKey(state)
  const totals = invoicedQtyByKey(state, considered)
  for (const [key, qty] of totals) {
    const orderedQty = ordered.get(key)
    if (orderedQty === undefined || qty > orderedQty + QTY_EPSILON) {
      return { ok: false, status: 409, error: `Concurrent invoicing would exceed the ordered quantity on sales order ${soLabel(state)}.` }
    }
  }
  const value = considered.reduce((sum, inv) => sum + invoiceShare(state, inv), 0)
  if (value > Number(state.so.total) + MONEY_TOLERANCE) {
    return { ok: false, status: 409, error: `Concurrent invoicing would exceed the total of sales order ${soLabel(state)}.` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------
// Data access + the two workflows
// ---------------------------------------------------------------------------------------------------------

type Db = any // supabase-js client (or a test double)
const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export async function loadSoInvoicingState(db: Db, soId: number): Promise<SoInvoicingState | null> {
  const so = must(
    await db
      .from("sales_orders")
      .select("so_id, so_number, customer_id, total, subtotal, discount_amount, payment_type, payment_terms, installments")
      .eq("so_id", soId)
      .maybeSingle(),
    "load sales order",
  )
  if (!so) return null

  const soItems = must(
    await db.from("sales_order_items").select("product_id, outsourced_name, quantity").eq("so_id", soId),
    "load sales order items",
  ) as any[]
  const permitRows = must(
    await db.from("delivery_permits").select("permit_id, permit_no, status").eq("sales_order_id", soId),
    "load delivery permits",
  ) as any[]
  const permitIds = permitRows.map((p) => p.permit_id)

  const itemRows = permitIds.length
    ? (must(
        await db
          .from("delivery_permit_items")
          .select("permit_id, product_id, item_name_snapshot, quantity, unit_price, total")
          .in("permit_id", permitIds),
        "load delivery permit items",
      ) as any[])
    : []
  const ownLinks = permitIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("permit_id", permitIds), "load invoice links") as any[])
    : []

  const bySo = must(
    await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount").eq("so_id", soId),
    "load invoices by sales order",
  ) as any[]
  const linkedIds = [...new Set(ownLinks.map((l) => l.invoice_id))]
  const byLink = linkedIds.length
    ? (must(await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount").in("invoice_id", linkedIds), "load linked invoices") as any[])
    : []
  const invoiceRows = new Map<number, any>()
  for (const row of [...bySo, ...byLink]) invoiceRows.set(row.invoice_id, row)

  const allIds = [...invoiceRows.keys()]
  const allLinks = allIds.length
    ? (must(await db.from("invoice_delivery_permits").select("invoice_id, permit_id").in("invoice_id", allIds), "load all invoice links") as any[])
    : []

  return {
    so: {
      ...so,
      total: Number(so.total) || 0,
      subtotal: Number(so.subtotal) || 0,
      discount_amount: Number(so.discount_amount) || 0,
    },
    soItems: soItems.map((i) => ({ product_id: i.product_id, outsourced_name: i.outsourced_name, quantity: Number(i.quantity) || 0 })),
    permits: permitRows.map((p) => ({
      permit_id: p.permit_id,
      permit_no: p.permit_no,
      status: p.status,
      items: itemRows.filter((i) => i.permit_id === p.permit_id).map((i) => ({ ...i, quantity: Number(i.quantity) || 0 })),
    })),
    invoices: [...invoiceRows.values()].map((r) => ({
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_number,
      so_id: r.so_id,
      amount: Number(r.amount) || 0,
      permit_ids: allLinks.filter((l) => l.invoice_id === r.invoice_id).map((l) => l.permit_id),
    })),
  }
}

async function nextInvoiceNumber(db: Db, attemptOffset: number) {
  const year = new Date().getFullYear()
  const rows = must(
    await db.from("accounts_receivable").select("invoice_number").like("invoice_number", `INV-${year}-%`),
    "load invoice numbers",
  ) as any[]
  let max = 0
  for (const row of rows) {
    const match = /^INV-\d{4}-(\d+)$/.exec(row.invoice_number || "")
    if (match) max = Math.max(max, Number.parseInt(match[1], 10))
  }
  return `INV-${year}-${String(max + 1 + attemptOffset).padStart(4, "0")}`
}

// Insert an accounts_receivable row, retrying with the next number if another request took the same one
// (UNIQUE(invoice_number) is the guard).
async function insertInvoice(db: Db, row: Record<string, any>) {
  let lastError: any = null
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(db, attempt)
    const { data, error } = await db.from("accounts_receivable").insert({ ...row, invoice_number: invoiceNumber }).select().single()
    if (!error) return data
    lastError = error
    if (error.code !== "23505") break
  }
  throw new Error(`create invoice: ${lastError?.message || lastError}`)
}

async function rollbackInvoice(db: Db, invoiceId: number) {
  const steps: [string, any][] = [
    ["unlink delivery permits", await db.from("invoice_delivery_permits").delete().eq("invoice_id", invoiceId)],
    ["clear delivery_permits.invoice_id", await db.from("delivery_permits").update({ invoice_id: null }).eq("invoice_id", invoiceId)],
    ["delete invoice", await db.from("accounts_receivable").delete().eq("invoice_id", invoiceId)],
  ]
  for (const [what, res] of steps) {
    if (res.error) console.error(`[invoicing] ROLLBACK FAILED (${what}) for invoice ${invoiceId}: ${res.error.message}. Manual review needed.`)
  }
}

export interface WorkflowResult {
  status: number
  body: any
}
const failure = (status: number, error: string, extra: Record<string, any> = {}): WorkflowResult => ({ status, body: { error, ...extra } })

// ---- Workflow A: sales order -> invoice -------------------------------------------------------------------
export async function createSoInvoice(db: Db, soId: number): Promise<WorkflowResult> {
  try {
    const state = await loadSoInvoicingState(db, soId)
    if (!state) return failure(404, "Sales order not found")

    const verdict = evaluateSoInvoice(state)
    if (!verdict.ok) return failure(verdict.status, verdict.error, { invoiceNumber: state.invoices[0]?.invoice_number, invoiceId: state.invoices[0]?.invoice_id })

    const paymentType = state.so.payment_type || state.so.payment_terms || "cash"
    const invoice = await insertInvoice(db, {
      customer_id: state.so.customer_id,
      so_id: state.so.so_id,
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      amount: state.so.total, // existing authoritative SO calculation (discount + VAT already applied)
      collected_amount: 0,
      payment_terms: paymentType,
      installment_months: resolveInstallmentCount(paymentType, state.so.installments) || 1,
      months_paid: 0,
      status: "pending",
    })

    // Safety net against a concurrent request: the lowest invoice_id wins.
    const after = await loadSoInvoicingState(db, soId)
    const check = after ? evaluateAfterInsert(after, invoice.invoice_id) : ({ ok: true } as Verdict)
    if (!check.ok) {
      await rollbackInvoice(db, invoice.invoice_id)
      return failure(check.status, check.error)
    }

    const customer = state.so.customer_id
      ? must(await db.from("customers").select("customer_name").eq("customer_id", state.so.customer_id).maybeSingle(), "load customer")
      : null
    return {
      status: 200,
      body: {
        ...invoice,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id,
        customerName: customer?.customer_name,
        soId: invoice.so_id,
        soNumber: state.so.so_number,
        deliveryPermits: state.permits.map((p) => ({ permit_id: p.permit_id, permit_no: p.permit_no, status: p.status })),
      },
    }
  } catch (error: any) {
    console.error("Error creating invoice from SO:", error)
    return failure(500, error?.message || "Failed to create invoice")
  }
}

// ---- Workflow B: delivery permit(s) -> invoice ------------------------------------------------------------
export async function createDpInvoices(db: Db, permitIds: number[]): Promise<WorkflowResult> {
  try {
    const permits = must(
      await db.from("delivery_permits").select("permit_id, permit_no, sales_order_id, status").in("permit_id", permitIds),
      "load delivery permits",
    ) as any[]
    if (!permits || permits.length === 0) return failure(404, "Delivery permits not found")
    const missing = permitIds.filter((id) => !permits.some((p) => p.permit_id === id))
    if (missing.length > 0) return failure(404, `Delivery permits not found: ${missing.join(", ")}`)

    const notApproved = permits.filter((p) => p.status !== "APPROVED")
    if (notApproved.length > 0) {
      return failure(400, `Only APPROVED delivery permits can be invoiced. Not approved: ${notApproved.map((p) => `${p.permit_no} (${p.status})`).join(", ")}`)
    }

    const soIds = [...new Set(permits.map((p) => p.sales_order_id))]
    const orders = must(
      await db.from("sales_orders").select("so_id, customer_id, payment_type, payment_terms").in("so_id", soIds),
      "load sales orders",
    ) as any[]
    const orderById = new Map(orders.map((o) => [o.so_id, o]))
    if (soIds.some((id) => !orderById.has(id))) return failure(404, "Sales order not found for a delivery permit")

    const customerIds = new Set(orders.map((o) => o.customer_id))
    if (customerIds.size > 1) return failure(400, "Selected delivery permits belong to different customers. Cannot consolidate.")

    const existingLinks = must(
      await db.from("invoice_delivery_permits").select("permit_id").in("permit_id", permitIds),
      "check existing invoices",
    ) as any[]
    if (existingLinks.length > 0) {
      return failure(400, `Delivery permits already invoiced: ${existingLinks.map((l) => l.permit_id).join(", ")}`)
    }

    const byPaymentType: Record<string, any[]> = {}
    for (const permit of permits) {
      const order = orderById.get(permit.sales_order_id)
      const paymentType = order.payment_type || order.payment_terms || "cash"
      ;(byPaymentType[paymentType] ||= []).push(permit)
    }
    const paymentTypes = Object.keys(byPaymentType)
    if (paymentTypes.length > 1) {
      return {
        status: 200,
        body: {
          requiresSplit: true,
          message: `Selected DPs have ${paymentTypes.length} different payment terms. Will create ${paymentTypes.length} separate invoices.`,
          preview: paymentTypes.map((pt) => ({
            payment_type: pt,
            dp_count: byPaymentType[pt].length,
            permit_ids: byPaymentType[pt].map((p) => p.permit_id),
          })),
        },
      }
    }

    const paymentType = paymentTypes[0]
    const group = byPaymentType[paymentType]
    const groupSoIds = [...new Set(group.map((p) => p.sales_order_id))] as number[]

    // Pre-check every affected sales order, and price the invoice from the items on the selected permits.
    let amount = 0
    const states = new Map<number, SoInvoicingState>()
    for (const soId of groupSoIds) {
      const state = await loadSoInvoicingState(db, soId)
      if (!state) return failure(404, "Sales order not found")
      const ids = group.filter((p) => p.sales_order_id === soId).map((p) => p.permit_id)
      const verdict = evaluateDpInvoice(state, ids)
      if (!verdict.ok) return failure(verdict.status, verdict.error)
      amount += verdict.newValue || 0
      states.set(soId, state)
    }
    amount = round2(amount)

    const firstState = states.get(group[0].sales_order_id)!
    const invoice = await insertInvoice(db, {
      customer_id: Array.from(customerIds)[0],
      so_id: group[0].sales_order_id,
      // Provenance: a single-DP invoice points at its delivery permit; multi-DP invoices use invoice_delivery_permits.
      source_delivery_permit_id: group.length === 1 ? group[0].permit_id : null,
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      amount,
      collected_amount: 0,
      payment_terms: paymentType,
      installment_months: resolveInstallmentCount(paymentType, firstState.so.installments) || 1,
      months_paid: 0,
      status: "pending",
    })

    const { error: linksError } = await db
      .from("invoice_delivery_permits")
      .insert(group.map((p) => ({ invoice_id: invoice.invoice_id, permit_id: p.permit_id })))
    if (linksError) {
      await rollbackInvoice(db, invoice.invoice_id)
      if (linksError.code === "23505") return failure(409, "One of the delivery permits was invoiced by another request. Nothing was created.")
      return failure(500, "Failed to link delivery permits")
    }

    // Backward-compatible column (the AR screen filters on it).
    const { error: compatError } = await db
      .from("delivery_permits")
      .update({ invoice_id: invoice.invoice_id })
      .in("permit_id", group.map((p) => p.permit_id))
    if (compatError) {
      await rollbackInvoice(db, invoice.invoice_id)
      return failure(500, "Failed to mark delivery permits as invoiced. Nothing was created.")
    }

    // Safety net against concurrent requests: the lowest invoice_id wins.
    for (const soId of groupSoIds) {
      const after = await loadSoInvoicingState(db, soId)
      const check = after ? evaluateAfterInsert(after, invoice.invoice_id) : ({ ok: true } as Verdict)
      if (!check.ok) {
        await rollbackInvoice(db, invoice.invoice_id)
        return failure(check.status, check.error)
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        invoices: [
          {
            ...invoice,
            invoiceNumber: invoice.invoice_number,
            deliveryPermits: group.map((p) => p.permit_no),
            paymentType,
          },
        ],
        message: "Invoice created successfully",
      },
    }
  } catch (error: any) {
    console.error("Error creating invoice from DPs:", error)
    return failure(500, error?.message || "Failed to create invoice")
  }
}
