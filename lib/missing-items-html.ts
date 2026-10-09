// HTML for the Missing Items report (Batch 3). Pure: takes the data from lib/missing-items.ts.
import { escapeHtml } from "./print-html"
import type { MissingItemsReport } from "./missing-items"
import { PRINT_CSS, docTitle } from "./print/print-theme"

const money = (n: number) => `EGP ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (s: string | null | undefined) => {
  if (!s) return "-"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** `hideCost` removes the Unit Cost column and the total value that depends on it. Nothing else changes. */
export function renderMissingItemsHtml(report: MissingItemsReport, opts: { hideCost: boolean; generatedAt: string }): string {
  const { so, rows } = report
  const missing = rows.filter((r) => r.missing > 0)
  const hideCost = opts.hideCost
  // value of what is still missing, from the items that HAVE a cost; items without one are counted, never priced
  const costed = missing.filter((r) => r.unitCost !== null)
  const totalValue = costed.reduce((s, r) => s + r.missing * (r.unitCost as number), 0)
  const uncosted = missing.length - costed.length
  const atPoPrice = costed.filter((r) => r.costSource === "po_price").length

  const badge = (status: string) =>
    status.startsWith("Ordered") ? "badge-ordered" : status.startsWith("Partially") ? "badge-partial" : status.startsWith("Rejected") ? "badge-rejected" : status.startsWith("Stock") ? "badge-stock" : "badge-needs-po"

  const body = missing
    .map(
      (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.name)}${r.sku !== "-" ? `<div class="sku">SKU: ${escapeHtml(r.sku)}</div>` : ""}</td>
          <td><span class="type-tag ${r.isOutsourced ? "type-outsourced" : "type-stock"}">${r.isOutsourced ? "Outsourced" : "Stock"}</span></td>
          <td>${escapeHtml(r.supplierName)}</td>
          ${hideCost ? "" : `<td>${r.unitCost === null ? "n/a" : money(r.unitCost)}${r.costSource === "po_price" ? '<div class="sku">PO Price</div>' : ""}</td>`}
          <td class="n">${r.ordered}</td>
          <td class="n">${r.outForDelivery}</td>
          <td class="n">${r.delivered}</td>
          <td class="n">${r.returned}</td>
          <td class="n">${r.netDelivered}</td>
          <td class="n missing">${r.missing}</td>
          <td class="n">${r.poOrdered}</td>
          <td class="n">${r.received}</td>
          <td><span class="badge ${badge(r.procurementStatus)}">${escapeHtml(r.procurementStatus)}</span>${r.inProgress > 0 ? `<div class="sku">${r.inProgress} on a permit not yet out for delivery</div>` : ""}</td>
        </tr>`,
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Missing Items — ${escapeHtml(so.so_number)}</title>
  <style>
    ${PRINT_CSS}
    @page { size: A4 landscape; margin: 12mm; }
    .container { max-width: 1200px; margin: 0 auto; }
    .mi-sub { font-size: 12px; color: #555; }
    .mi-generated { margin-block-start: 2px; font-size: 11px; color: #555; }
    .pm-fields .pm-label { display: inline; }
    .pm-table { font-size: 11px; }
    .pm-table th.n, .pm-table td.n { text-align: center; }
    .pm-table td.missing { font-weight: 700; }
    .sku { color: #555; font-size: 10px; }
    .badge, .type-tag { font-size: 10px; font-weight: 600; }
    .totals { text-align: end; font-size: 13px; margin-block-end: 12px; break-inside: avoid; }
    .totals .value { font-weight: 700; font-size: 16px; }
    .note { font-size: 11px; color: #555; }
    .legend { font-size: 11px; color: #555; margin-block-end: 16px; }
    .empty-state { text-align: center; padding: 40px; border: 1px solid #ccc; color: #555; }
    .print-button { position: fixed; top: 14px; right: 14px; padding: 10px 18px; background: #1a56db; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; z-index: 1000; }
    @media screen { body { padding: 24px; } }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  <div class="container">
    ${docTitle({ titleAr: `Missing Items Report` })}
    <div class="mi-sub">Items on this sales order not yet delivered to the customer</div>
    <div class="mi-generated">Generated: ${escapeHtml(opts.generatedAt)}</div>
    <div class="pm-info">
      <div class="pm-fields">
        <div class="pm-field"><span class="pm-label">Sales Order #:</span> <span class="pm-value">${escapeHtml(so.so_number)}</span></div>
        <div class="pm-field"><span class="pm-label">Customer:</span> <span class="pm-value">${escapeHtml(so.customerName)}</span></div>
        <div class="pm-field"><span class="pm-label">Order Date:</span> <span class="pm-value">${date(so.order_date)}</span></div>
        <div class="pm-field"><span class="pm-label">Delivery Date:</span> <span class="pm-value">${date(so.delivery_date)}</span></div>
        <div class="pm-field"><span class="pm-label">Order Status:</span> <span class="pm-value">${escapeHtml(so.status)}</span></div>
        <div class="pm-field"><span class="pm-label">Delivery Permits Issued:</span> <span class="pm-value">${report.permitCount}</span></div>
      </div>
    </div>
    ${
      missing.length === 0
        ? `<div class="empty-state">✅ No missing items — every line item on this order has been delivered.</div>`
        : `
    <div class="legend">Ordered = sales order quantity · Out for Delivery = on permits currently out for delivery · Delivered = on delivered / approved permits · Returned = accepted returns · Net = Delivered − Returned · Missing = Ordered − Net − Out for Delivery · PO Ordered = active purchase orders · Received = goods receipts</div>
    <table class="pm-table">
      <thead>
        <tr>
          <th>#</th><th style="width:20%">Item</th><th>Type</th><th>Supplier</th>
          ${hideCost ? "" : "<th>Unit Cost</th>"}
          <th class="n">Ordered</th><th class="n">Out for Delivery</th><th class="n">Delivered</th><th class="n">Returned</th><th class="n">Net Delivered</th><th class="n">Missing</th><th class="n">PO Ordered</th><th class="n">Received</th><th style="width:20%">Procurement</th>
        </tr>
      </thead>
      <tbody>${body}
      </tbody>
    </table>
    ${
      hideCost
        ? ""
        : `<div class="totals">Total cost of missing items: <span class="value">${money(totalValue)}</span>${atPoPrice > 0 ? `<div class="note">${atPoPrice} item${atPoPrice === 1 ? "" : "s"} valued at PO Price (supplier price, not landed cost)</div>` : ""}${uncosted > 0 ? `<div class="note">${uncosted} item${uncosted === 1 ? "" : "s"} with unit cost n/a not included</div>` : ""}</div>`
    }`
    }
  </div>
</body>
</html>`
}
