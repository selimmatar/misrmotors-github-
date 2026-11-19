// E-invoice preview of one customer invoice (spec §2 goal 6-7, §6 "Which lines an invoice contains", §9): exactly the
// lines the invoice bills (the input step 2 will send), each with its item code and state, the portal totals and what
// is still missing before it could be sent. Read-only.
import { matchCode, type CodeState, type MatchContext } from "./codes"
import { loadMatchContext, readEtaSettings } from "./store"
import { etaLines, isAfterGoLive, type EtaLineIn, type EtaLineOut, type EtaTotals } from "./totals"
import { billedLinesForInvoice, loadSoInvoicingState, loadStandaloneLines, orderDiscountRate, round2 } from "../invoicing"
import { loadCustomerIdentities, loadInvoiceIdentityId, pickIdentity, type TaxIdentity } from "./identities"

type Db = any

export type EtaMissing =
  | "company_rin"
  | "company_activity"
  | "company_address"
  | "receiver_identity"
  | "customer_tax_number"
  | "customer_address"
  | "line_codes"
  | "portal_codes"
  | "amount_mismatch"

export type EtaItemType = "EGS" | "GS1"

/**
 * The portal code scheme of an item code: the type stored on the code when set, else by its shape - the company's own
 * codes are EGS ("EG-{RIN}-..."), any other code GS1.
 */
export const etaItemType = (itemCode: string | null | undefined, stored?: string | null): EtaItemType => {
  if (stored === "EGS" || stored === "GS1") return stored
  const code = String(itemCode ?? "").trim()
  return !code || /^EG-/i.test(code) ? "EGS" : "GS1"
}

export interface EtaPreviewLine extends EtaLineOut {
  codeId: number | null
  itemCode: string | null
  itemType: EtaItemType
  /** the order discount rate the line was priced with (a fraction, 0.1 = 10 %) */
  discountRate: number
  unit: string
  state: CodeState
  /** the stock product the line bills (null for an outsourced / free-text line): confirming sets its card code when empty */
  productId?: number | null
  /** the item code the accountant used on the portal for this name, when it differs from the product card's (orange) */
  portalItemCode?: string | null
}

export interface EtaPreview {
  invoiceId: number
  invoiceNumber: string
  /** created before go-live, go-live not set, or marked "already on the portal" - never sent */
  handledManually: boolean
  /** the portal ID given when the invoice was marked "already on the portal" */
  manualEtaUuid: string | null
  /** accounts_receivable.amount - what the invoice bills; "amount_mismatch" when the preview total differs from it */
  storedAmount: number
  customer: {
    name: string
    receiverType: string
    taxRegistrationNumber: string | null
    nationalId: string | null
    address: { governorate: string; regionCity: string; street: string; buildingNumber: string }
  }
  lines: EtaPreviewLine[]
  totals: EtaTotals
  missing: EtaMissing[]
  /**
   * The customer's active tax identities (names only - the window's drop-down never shows tax numbers); empty when the
   * customer has none (its card fields are used).
   */
  identities?: { identityId: number; name: string }[]
  /** the identity this invoice is issued for (chosen, or the only one); null with none or 2+ and none chosen */
  identityId?: number | null
}

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}
const text = (value: unknown) => (value == null ? "" : String(value).trim())

/** The e-invoice preview of a customer invoice (accounts_receivable.invoice_id); null when there is no such invoice. */
export async function buildEtaPreview(
  db: Db,
  invoiceId: number,
  /** already-loaded match context and settings, when many invoices are previewed in one request */
  pre: { ctx?: MatchContext; settings?: Record<string, string> } = {},
): Promise<EtaPreview | null> {
  const invoice = must(
    await db.from("accounts_receivable").select("invoice_id, invoice_number, so_id, amount, customer_id, created_at").eq("invoice_id", invoiceId).maybeSingle(),
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
  // A standalone MINV (no sales order, no permits) carries its own lines.
  if (soIds.length === 0) {
    const own = await loadStandaloneLines(db, invoiceId)
    if (own.length > 0) groups.push({ lines: own.map((l) => ({ line: l, productId: null })), rate: 0 })
  }

  const productIds = [...new Set(groups.flatMap((g) => g.lines.map((b) => b.productId)).filter((id): id is number => id != null))]
  const products = productIds.length
    ? (must(await db.from("products").select("product_id, product_name, eta_code_id, eta_unit_type").in("product_id", productIds), "load products") as any[])
    : []
  const productById = new Map<number, any>(products.map((p) => [p.product_id, p]))

  const [ctx, settings, customer, documents] = await Promise.all([
    pre.ctx ? Promise.resolve(pre.ctx) : loadMatchContext(db),
    pre.settings ? Promise.resolve(pre.settings) : readEtaSettings(db),
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
  const codeById = new Map(ctx.codes.map((c) => [c.codeId, c]))

  const lines: EtaPreviewLine[] = []
  const sums = { sales: 0, discount: 0, net: 0, vat: 0, total: 0 }
  for (const group of groups) {
    const input = group.lines.map((b) => ({
      ...b.line,
      // a stock line on a whole-order invoice has no name of its own: its product's name
      name: b.line.name || text(b.productId != null ? productById.get(b.productId)?.product_name : ""),
    }))
    const priced = etaLines(input, group.rate)
    // the rate etaLines priced with (it treats a bad or negative rate as none)
    const rate = Number.isFinite(group.rate) && group.rate > 0 ? group.rate : 0
    priced.lines.forEach((line, idx) => {
      const product = group.lines[idx].productId != null ? productById.get(group.lines[idx].productId!) : null
      const match = matchCode({ name: line.name, productCodeId: product?.eta_code_id ?? null, productUnit: text(product?.eta_unit_type) || null }, ctx)
      const code = match.codeId != null ? codeById.get(match.codeId) : undefined
      const itemCode = code?.itemCode ?? null
      const productId = group.lines[idx].productId ?? null
      lines.push({
        ...line, codeId: match.codeId, itemCode, itemType: etaItemType(itemCode, code?.codeType), discountRate: rate, unit: match.unit, state: match.state, productId,
        ...(match.portalCodeId != null ? { portalItemCode: itemCode } : {}),
      })
    })
    for (const key of Object.keys(sums) as (keyof EtaTotals)[]) sums[key] += priced.totals[key]
  }
  const totals: EtaTotals = { sales: round2(sums.sales), discount: round2(sums.discount), net: round2(sums.net), vat: round2(sums.vat), total: round2(sums.total) }

  const manual = documents.find((d: any) => d.status === "manual") || null

  // The receiver: the customer's chosen (or only) active tax identity; the card fields when it has none.
  const active: TaxIdentity[] = invoice.customer_id != null ? await loadCustomerIdentities(db, invoice.customer_id, { activeOnly: true }) : []
  const pick = pickIdentity(active, active.length > 1 ? await loadInvoiceIdentityId(db, invoiceId) : null)
  const receiver =
    pick.kind === "identity"
      ? {
          name: pick.identity.name,
          receiverType: pick.identity.receiverType,
          taxNumber: pick.identity.taxRegistrationNumber,
          nationalId: pick.identity.nationalId,
          address: [pick.identity.governorate, pick.identity.region, pick.identity.street, pick.identity.buildingNumber],
        }
      : pick.kind === "choose"
        ? { name: text(customer?.customer_name), receiverType: "B", taxNumber: "", nationalId: "", address: ["", "", "", ""] }
        : {
            name: text(customer?.customer_name),
            receiverType: text(customer?.eta_receiver_type) || "B",
            taxNumber: text(customer?.tax_registration_number),
            nationalId: text(customer?.national_id),
            address: [customer?.address_governorate, customer?.address_region, customer?.address_street, customer?.address_building_number].map(text),
          }
  const receiverType = receiver.receiverType
  const taxNumber = receiver.taxNumber

  const missing: EtaMissing[] = []
  if (!/^\d{9}$/.test(text(settings.eta_rin))) missing.push("company_rin")
  if (!/^\d{4}$/.test(text(settings.eta_activity_code))) missing.push("company_activity")
  if (["eta_branch_governorate", "eta_branch_region", "eta_branch_street", "eta_branch_building_number"].some((k) => !text(settings[k]))) {
    missing.push("company_address")
  }
  if (pick.kind === "choose") {
    // which company the invoice is for comes first; that company's own checks follow once it is chosen
    missing.push("receiver_identity")
  } else if (receiverType === "B") {
    if (!/^\d{9}$/.test(taxNumber)) missing.push("customer_tax_number")
    if (receiver.address.some((part) => !text(part))) missing.push("customer_address")
  } else if (receiverType === "P") {
    if (!/^\d{14}$/.test(text(receiver.nationalId))) missing.push("customer_tax_number")
  }
  if (lines.some((l) => l.state === "red" || l.codeId == null)) missing.push("line_codes")
  // the accountant used another code on the portal for a line's name: nothing is sent until the line is confirmed
  if (lines.some((l) => l.portalItemCode)) missing.push("portal_codes")
  // The preview is recomputed from today's data; a return rejected or an order edited after invoicing moves it away
  // from what the invoice stored. Such an invoice must not be sent as is.
  const storedAmount = round2(Number(invoice.amount) || 0)
  const handledManually = !isAfterGoLive(invoice.created_at, settings.eta_go_live_at) || manual !== null
  if (!handledManually && Math.abs(totals.total - storedAmount) > 0.005) missing.push("amount_mismatch")

  return {
    invoiceId,
    invoiceNumber: text(invoice.invoice_number),
    handledManually,
    manualEtaUuid: manual ? text(manual.eta_uuid) || null : null,
    storedAmount,
    customer: {
      name: receiver.name,
      receiverType,
      taxRegistrationNumber: taxNumber || null,
      nationalId: text(receiver.nationalId) || null,
      address: {
        governorate: text(receiver.address[0]),
        regionCity: text(receiver.address[1]),
        street: text(receiver.address[2]),
        buildingNumber: text(receiver.address[3]),
      },
    },
    lines,
    totals,
    missing,
    identities: active.map((i) => ({ identityId: i.identityId, name: i.name })),
    identityId: pick.kind === "identity" ? pick.identity.identityId : null,
  }
}
