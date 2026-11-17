// E-invoice (Egyptian Tax Authority) document v1.0 - spec §6.2 / §6.4. Pure, no I/O.
//
// Built from the step-1 preview (lines priced by the per-line rule in ./totals, so the portal equations hold:
// salesTotal = quantity x amountEGP, netTotal = salesTotal - discount.amount, VAT = netTotal x 14 %,
// total = netTotal + VAT, totalAmount = sum of line totals). Property names and order follow the portal SDK sample;
// toEtaJson (./serialize) writes the body in exactly this order and the signed text is computed from that body.
import type { EtaItemType, EtaPreview } from "./preview"
import { toLatinDigits } from "./egypt"

/** The e-invoice company settings as readEtaSettings returns them (setting_key -> value). */
export type EtaSettings = Record<string, string>

export interface EtaIssuerAddress {
  branchID: string
  country: "EG"
  governate: string
  regionCity: string
  street: string
  buildingNumber: string
}
export interface EtaReceiverAddress {
  country: "EG"
  governate: string
  regionCity: string
  street: string
  buildingNumber: string
}
export interface EtaTaxableItem {
  taxType: "T1"
  amount: number
  subType: "V009"
  rate: 14
}
export interface EtaInvoiceLine {
  description: string
  itemType: EtaItemType
  itemCode: string
  unitType: string
  quantity: number
  internalCode: string
  salesTotal: number
  total: number
  valueDifference: number
  totalTaxableFees: number
  netTotal: number
  itemsDiscount: number
  unitValue: { currencySold: "EGP"; amountEGP: number }
  discount: { rate: number; amount: number }
  taxableItems: EtaTaxableItem[]
}
export interface EtaDocument {
  issuer: { address: EtaIssuerAddress; type: "B"; id: string; name: string }
  receiver: { address: EtaReceiverAddress; type: string; id: string; name: string }
  documentType: "i" | "c"
  documentTypeVersion: "1.0"
  dateTimeIssued: string
  taxpayerActivityCode: string
  internalID: string
  /** credit note only: the portal uuid of the invoice it reverses */
  references?: string[]
  invoiceLines: EtaInvoiceLine[]
  totalDiscountAmount: number
  totalSalesAmount: number
  netAmount: number
  taxTotals: { taxType: "T1"; amount: number }[]
  totalAmount: number
  extraDiscountAmount: number
  totalItemsDiscountAmount: number
}

const ETA_VAT_PERCENT = 14
const text = (value: unknown) => (value == null ? "" : String(value).trim())
/** numbers typed with Arabic-Indic digits ("٢١٢") are sent as Latin digits ("212"), as the portal prints them */
const digits = (value: unknown) => toLatinDigits(text(value))
const round5 = (value: number) => Number((Number(value) || 0).toFixed(5))

/** `YYYY-MM-DDTHH:mm:ssZ` (UTC, no milliseconds), as the portal takes it. */
export function etaDateTime(issuedAt: string): string {
  const ms = Date.parse(String(issuedAt ?? ""))
  if (!String(issuedAt ?? "").trim() || Number.isNaN(ms)) throw new Error(`Invalid issue date: ${issuedAt}`)
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function buildInvoiceDocument(preview: EtaPreview, settings: EtaSettings, issuedAt: string): EtaDocument {
  const c = preview.customer
  const receiverType = text(c.receiverType) || "B"
  const receiverId = receiverType === "P" ? text(c.nationalId) : text(c.taxRegistrationNumber) || text(c.nationalId)
  const lines: EtaInvoiceLine[] = preview.lines.map((l, idx) => {
    if (!text(l.itemCode)) throw new Error(`Line ${idx + 1} (${l.name}) has no item code`)
    return {
      description: text(l.name),
      itemType: l.itemType,
      itemCode: text(l.itemCode),
      unitType: text(l.unit) || "EA",
      quantity: l.quantity,
      internalCode: String(idx + 1),
      salesTotal: l.salesTotal,
      total: l.total,
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: l.netTotal,
      itemsDiscount: 0,
      unitValue: { currencySold: "EGP", amountEGP: l.unitPrice },
      discount: { rate: l.discount > 0 ? round5((Number(l.discountRate) || 0) * 100) : 0, amount: l.discount },
      taxableItems: [{ taxType: "T1", amount: l.vat, subType: "V009", rate: ETA_VAT_PERCENT }],
    }
  })
  return inPortalOrder({
    issuer: {
      address: {
        branchID: digits(settings.eta_branch_id) || "0",
        country: "EG",
        governate: text(settings.eta_branch_governorate),
        regionCity: text(settings.eta_branch_region),
        street: text(settings.eta_branch_street),
        buildingNumber: digits(settings.eta_branch_building_number),
      },
      type: "B",
      id: digits(settings.eta_rin),
      name: text(settings.eta_registered_name),
    },
    receiver: {
      address: {
        country: "EG",
        governate: text(c.address?.governorate),
        regionCity: text(c.address?.regionCity),
        street: text(c.address?.street),
        buildingNumber: digits(c.address?.buildingNumber),
      },
      type: receiverType,
      id: receiverId,
      name: text(c.name),
    },
    documentType: "i",
    documentTypeVersion: "1.0",
    dateTimeIssued: etaDateTime(issuedAt),
    taxpayerActivityCode: digits(settings.eta_activity_code),
    internalID: text(preview.invoiceNumber),
    invoiceLines: lines,
    totalDiscountAmount: preview.totals.discount,
    totalSalesAmount: preview.totals.sales,
    netAmount: preview.totals.net,
    taxTotals: [{ taxType: "T1", amount: preview.totals.vat }],
    totalAmount: preview.totals.total,
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  })
}

/**
 * A credit note for the whole invoice: the invoice's sent snapshot (issuer, receiver, lines, totals, internalID) with
 * documentType "c" and references = [the invoice's portal uuid]. The snapshot may come back from the database with its
 * keys reordered, so the note is rewritten in the portal order.
 */
export function buildCreditNoteDocument(invoiceSnapshot: EtaDocument, invoiceUuid: string, issuedAt: string): EtaDocument {
  const uuid = text(invoiceUuid)
  if (!uuid) throw new Error("The invoice's portal uuid is required for a credit note")
  return inPortalOrder({ ...invoiceSnapshot, documentType: "c", dateTimeIssued: etaDateTime(issuedAt), references: [uuid] })
}

/** A fresh copy of the document with every object's keys in the portal order (and nothing else). */
function inPortalOrder(d: EtaDocument): EtaDocument {
  const a = d.issuer.address
  const r = d.receiver.address
  return {
    issuer: {
      address: { branchID: a.branchID, country: a.country, governate: a.governate, regionCity: a.regionCity, street: a.street, buildingNumber: a.buildingNumber },
      type: d.issuer.type,
      id: d.issuer.id,
      name: d.issuer.name,
    },
    receiver: {
      address: { country: r.country, governate: r.governate, regionCity: r.regionCity, street: r.street, buildingNumber: r.buildingNumber },
      type: d.receiver.type,
      id: d.receiver.id,
      name: d.receiver.name,
    },
    documentType: d.documentType,
    documentTypeVersion: d.documentTypeVersion,
    dateTimeIssued: d.dateTimeIssued,
    taxpayerActivityCode: d.taxpayerActivityCode,
    internalID: d.internalID,
    ...(d.references ? { references: [...d.references] } : {}),
    invoiceLines: d.invoiceLines.map((l) => ({
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      internalCode: l.internalCode,
      salesTotal: l.salesTotal,
      total: l.total,
      valueDifference: l.valueDifference,
      totalTaxableFees: l.totalTaxableFees,
      netTotal: l.netTotal,
      itemsDiscount: l.itemsDiscount,
      unitValue: { currencySold: l.unitValue.currencySold, amountEGP: l.unitValue.amountEGP },
      discount: { rate: l.discount.rate, amount: l.discount.amount },
      taxableItems: l.taxableItems.map((t) => ({ taxType: t.taxType, amount: t.amount, subType: t.subType, rate: t.rate })),
    })),
    totalDiscountAmount: d.totalDiscountAmount,
    totalSalesAmount: d.totalSalesAmount,
    netAmount: d.netAmount,
    taxTotals: d.taxTotals.map((t) => ({ taxType: t.taxType, amount: t.amount })),
    totalAmount: d.totalAmount,
    extraDiscountAmount: d.extraDiscountAmount,
    totalItemsDiscountAmount: d.totalItemsDiscountAmount,
  }
}
