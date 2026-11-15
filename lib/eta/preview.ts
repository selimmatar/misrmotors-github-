// E-invoice preview of one customer invoice (spec §2 goal 6-7, §6 "Which lines an invoice contains", §9): exactly the
// lines the invoice bills (the input step 2 will send), each with its item code and state, the portal totals and what
// is still missing before it could be sent. Read-only.
import { matchCode, type CodeState } from "./codes"
import { loadMatchContext, readEtaSettings } from "./store"
import { etaLines, isAfterGoLive, type EtaLineIn, type EtaLineOut, type EtaTotals } from "./totals"
import { billedLinesForInvoice, loadSoInvoicingState, orderDiscountRate, round2 } from "../invoicing"

type Db = any

export type EtaMissing = "company_rin" | "company_activity" | "company_address" | "customer_tax_number" | "customer_address" | "line_codes"

export interface EtaPreviewLine extends EtaLineOut {
  codeId: number | null
  itemCode: string | null
  unit: string
  state: CodeState
}

export interface EtaPreview {
  invoiceId: number
  invoiceNumber: string
  /** created before go-live, go-live not set, or marked "already on the portal" - never sent */
  handledManually: boolean
  /** the portal ID given when the invoice was marked "already on the portal" */
  manualEtaUuid: string | null
  customer: { name: string; receiverType: string; taxRegistrationNumber: string | null }
  lines: EtaPreviewLine[]
  totals: EtaTotals
  missing: EtaMissing[]
}

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const text = (value: unknown) => (value == null ? "" : String(value).trim())

/** The e-invoice preview of a customer invoice (accounts_receivable.invoice_id); null when there is no such invoice. */
export async function buildEtaPreview(db: Db, invoiceId: number): Promise<EtaPreview | null> {
  const invoice = must(
    await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, customer_id, created_at").eq("invoice_id", invoiceId).maybeSingle(),
    "load invoice",
  )
  if (!invoice) return null

  // The sales orders the invoice bills: those of its delivery permits (one invoice may cover several orders of the
  // same customer), else its own sales order.
  const links = must(await db.from("invoice_delivery_permits").select("permit_id").eq("invoice_id", invoiceId), "load invoice links") as any[]
  let soIds: number[] = invoice.so_id ? [invoice.so_id] : []
  if (links.length > 0) {
    const permits = must(
      await db.from("delivery_permits").select("permit_id, sales_order_id").in("permit_id", links.map((l) => l.permit_id)),
      "load delivery permits",
    ) as any[]
    soIds = [...new Set(permits.map((p) => p.sales_order_id).filter((id) => id != null))] as number[]
  }

  // Each order's billed lines with that order's discount rate (spec §6).
  const groups: { lines: { line: EtaLineIn; productId: number | null }[]; rate: number }[] = []
  for (const soId of soIds) {
    const state = await loadSoInvoicingState(db, soId)
    const inv = state?.invoices.find((i) => i.invoice_id === invoiceId)
    if (!state || !inv) continue
    groups.push({
      // the same filter etaLines applies, so its output lines stay index-aligned with their products
      lines: billedLinesForInvoice(state, inv).filter((b) => Number(b.line.quantity) > 0),
      rate: orderDiscountRate(state.soItems, state.so.subtotal, state.so.discount_amount),
    })
  }

  const productIds = [...new Set(groups.flatMap((g) => g.lines.map((b) => b.productId)).filter((id): id is number => id != null))]
  const products = productIds.length
    ? (must(await db.from("products").select("product_id, product_name, eta_code_id, eta_unit_type").in("product_id", productIds), "load products") as any[])
    : []
  const productById = new Map<number, any>(products.map((p) => [p.product_id, p]))

  const [ctx, settings, customer, documents] = await Promise.all([
    loadMatchContext(db),
    readEtaSettings(db),
    invoice.customer_id != null
      ? db
          .from("customers")
          .select("customer_name, eta_receiver_type, tax_registration_number, national_id, address_governorate, address_region, address_street, address_building_number")
          .eq("customer_id", invoice.customer_id)
          .maybeSingle()
          .then((r: any) => must(r, "load customer"))
      : Promise.resolve(null),
    db.from("eta_documents").select("status, eta_uuid").eq("invoice_id", invoiceId).then((r: any) => must(r, "load e-invoice documents") as any[]),
  ])
  const itemCodeById = new Map(ctx.codes.map((c) => [c.codeId, c.itemCode]))

  const lines: EtaPreviewLine[] = []
  const sums = { sales: 0, discount: 0, net: 0, vat: 0, total: 0 }
  for (const group of groups) {
    const input = group.lines.map((b) => ({
      ...b.line,
      // a stock line on a whole-order invoice has no name of its own: its product's name
      name: b.line.name || text(b.productId != null ? productById.get(b.productId)?.product_name : ""),
    }))
    const priced = etaLines(input, group.rate)
    priced.lines.forEach((line, idx) => {
      const product = group.lines[idx].productId != null ? productById.get(group.lines[idx].productId!) : null
      const match = matchCode({ name: line.name, productCodeId: product?.eta_code_id ?? null, productUnit: text(product?.eta_unit_type) || null }, ctx)
      lines.push({ ...line, codeId: match.codeId, itemCode: match.codeId != null ? itemCodeById.get(match.codeId) ?? null : null, unit: match.unit, state: match.state })
    })
    for (const key of Object.keys(sums) as (keyof EtaTotals)[]) sums[key] += priced.totals[key]
  }
  const totals: EtaTotals = { sales: round2(sums.sales), discount: round2(sums.discount), net: round2(sums.net), vat: round2(sums.vat), total: round2(sums.total) }

  const manual = documents.find((d: any) => d.status === "manual") || null
  const receiverType = text(customer?.eta_receiver_type) || "B"
  const taxNumber = text(customer?.tax_registration_number)

  const missing: EtaMissing[] = []
  if (!/^\d{9}$/.test(text(settings.eta_rin))) missing.push("company_rin")
  if (!/^\d{4}$/.test(text(settings.eta_activity_code))) missing.push("company_activity")
  if (["eta_branch_governorate", "eta_branch_region", "eta_branch_street", "eta_branch_building_number"].some((k) => !text(settings[k]))) {
    missing.push("company_address")
  }
  if (receiverType === "B") {
    if (!/^\d{9}$/.test(taxNumber)) missing.push("customer_tax_number")
    const address = [customer?.address_governorate, customer?.address_region, customer?.address_street, customer?.address_building_number]
    if (address.some((part) => !text(part))) missing.push("customer_address")
  } else if (receiverType === "P") {
    if (!/^\d{14}$/.test(text(customer?.national_id))) missing.push("customer_tax_number")
  }
  if (lines.some((l) => l.state === "red" || l.codeId == null)) missing.push("line_codes")

  return {
    invoiceId,
    invoiceNumber: text(invoice.invoice_number),
    handledManually: !isAfterGoLive(invoice.created_at, settings.eta_go_live_at) || manual !== null,
    manualEtaUuid: manual ? text(manual.eta_uuid) || null : null,
    customer: { name: text(customer?.customer_name), receiverType, taxRegistrationNumber: taxNumber || null },
    lines,
    totals,
    missing,
  }
}
