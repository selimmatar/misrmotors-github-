import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function formatCurrency(amount: number): string {
  return `EGP ${(Number(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function errorPage(title: string, message: string, status: number) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family: Arial, sans-serif; padding: 60px; text-align: center; color: #333;">
      <h2 style="color: #dc2626;">${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const soIdParam = searchParams.get("soId")
    const soId = soIdParam ? Number.parseInt(soIdParam) : Number.NaN

    if (!soIdParam || Number.isNaN(soId)) {
      return errorPage("Missing Sales Order ID", "Please provide a valid sales order ID (soId).", 400)
    }

    const supabase = createAdminClient()

    // Sales order + customer
    const { data: so, error: soError } = await supabase
      .from("sales_orders")
      .select("so_id, so_number, order_date, delivery_date, status, fulfillment_status, customers(customer_name)")
      .eq("so_id", soId)
      .single()

    if (soError || !so) {
      return errorPage("Sales Order Not Found", `No sales order found for ID ${soId}.`, 404)
    }

    // Sales order line items
    const { data: soItemsRaw } = await supabase
      .from("sales_order_items")
      .select(
        "so_item_id, product_id, quantity, unit_price, item_type, outsourced_name, outsourced_description",
      )
      .eq("so_id", soId)
      .order("so_item_id", { ascending: true })

    const soItems = soItemsRaw || []

    // Product names for stock items
    const productIds = Array.from(
      new Set(soItems.filter((i) => i.product_id).map((i) => i.product_id as number)),
    )
    const productsMap = new Map<number, { name: string; sku: string }>()
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("product_id, product_name, sku")
        .in("product_id", productIds)
      for (const p of products || []) {
        productsMap.set(p.product_id, { name: p.product_name, sku: p.sku })
      }
    }

    // All delivery permits for this SO (any status — we just need to know what's been added)
    const { data: permits } = await supabase
      .from("delivery_permits")
      .select("permit_id, permit_no, status")
      .eq("sales_order_id", soId)
    const permitIds = (permits || []).map((p) => p.permit_id)

    let dpItems: any[] = []
    if (permitIds.length > 0) {
      const { data } = await supabase
        .from("delivery_permit_items")
        .select("product_id, item_name_snapshot, quantity")
        .in("permit_id", permitIds)
      dpItems = data || []
    }

    const addedByProduct = new Map<number, number>()
    const addedByName = new Map<string, number>()
    for (const dpItem of dpItems) {
      const qty = Number(dpItem.quantity) || 0
      if (dpItem.product_id) {
        addedByProduct.set(dpItem.product_id, (addedByProduct.get(dpItem.product_id) || 0) + qty)
      } else {
        const name = (dpItem.item_name_snapshot || "").trim()
        if (name) addedByName.set(name, (addedByName.get(name) || 0) + qty)
      }
    }

    // Purchase orders sourced from this SO's line items (to know if outsourced items are already on order)
    const soItemIds = soItems.map((i) => i.so_item_id)
    let poItems: any[] = []
    if (soItemIds.length > 0) {
      const { data } = await supabase
        .from("purchase_order_items")
        .select("source_so_item_id, purchase_orders(po_number, status)")
        .in("source_so_item_id", soItemIds)
      poItems = data || []
    }
    const poBySoItem = new Map<number, any[]>()
    for (const poItem of poItems) {
      const key = poItem.source_so_item_id as number
      if (!poBySoItem.has(key)) poBySoItem.set(key, [])
      poBySoItem.get(key)!.push(poItem)
    }

    // Compute the missing items: ordered quantity minus whatever has already been added to any DP
    const missingItems = soItems
      .map((item) => {
        const isOutsourced = item.item_type === "outsourced"
        const product = item.product_id ? productsMap.get(item.product_id) : undefined
        const itemName = isOutsourced ? item.outsourced_name || "Unnamed item" : product?.name || `Product #${item.product_id}`
        const sku = isOutsourced ? "-" : product?.sku || "-"

        const orderedQty = Number(item.quantity) || 0
        const addedQty = item.product_id
          ? addedByProduct.get(item.product_id) || 0
          : addedByName.get((item.outsourced_name || "").trim()) || 0
        const missingQty = Math.max(0, orderedQty - addedQty)

        let supplierName = "-"
        if (isOutsourced) {
          const supplierMatch = (item.outsourced_description || "").match(/Supplier:\s*([^|]+)/)
          supplierName = supplierMatch ? supplierMatch[1].trim() : "-"
        }

        let procurementStatus = "-"
        if (isOutsourced) {
          const relatedPOs = poBySoItem.get(item.so_item_id) || []
          const activePOs = relatedPOs.filter((p: any) => p.purchase_orders?.status !== "rejected")
          if (activePOs.length > 0) {
            const poLabels = activePOs
              .map((p: any) => `${p.purchase_orders?.po_number} (${p.purchase_orders?.status})`)
              .join(", ")
            procurementStatus = `Ordered — ${poLabels}`
          } else if (relatedPOs.length > 0) {
            const poLabels = relatedPOs.map((p: any) => p.purchase_orders?.po_number).join(", ")
            procurementStatus = `Rejected PO — Needs Reorder (${poLabels})`
          } else {
            procurementStatus = "Not Ordered — Needs PO"
          }
        } else {
          procurementStatus = "Stock Item — No PO Needed"
        }

        const unitPrice = Number(item.unit_price) || 0

        return {
          itemName,
          sku,
          isOutsourced,
          supplierName,
          unitPrice,
          orderedQty,
          missingQty,
          procurementStatus,
          missingValue: missingQty * unitPrice,
        }
      })
      .filter((item) => item.missingQty > 0)

    const totalMissingValue = missingItems.reduce((sum, item) => sum + item.missingValue, 0)
    const customerName = (so as any).customers?.customer_name || "-"
    const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Missing Items — ${escapeHtml(so.so_number)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4; margin: 15mm; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1f2937;
      margin: 0;
      padding: 24px;
      background: #fff;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #1a56db;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .header h1 { margin: 0; font-size: 20px; color: #1a56db; }
    .header .subtitle { margin-top: 4px; font-size: 12px; color: #6b7280; }
    .generated-at { font-size: 11px; color: #9ca3af; text-align: right; }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 24px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      padding: 16px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .info-grid .label { color: #6b7280; }
    .info-grid .value { font-weight: 600; color: #111827; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
    thead th {
      background: #1a56db;
      color: #fff;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
    }
    tbody td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-ordered { background: #dbeafe; color: #1e40af; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    .badge-needs-po { background: #fef3c7; color: #92400e; }
    .badge-stock { background: #dcfce7; color: #166534; }
    .type-tag {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .type-stock { background: #e0e7ff; color: #3730a3; }
    .type-outsourced { background: #fce7f3; color: #9d174d; }
    .totals { text-align: right; font-size: 13px; margin-bottom: 24px; }
    .totals .value { font-weight: 700; color: #1a56db; font-size: 16px; }
    .empty-state {
      text-align: center;
      padding: 40px;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      color: #6b7280;
    }
    .print-button {
      position: fixed;
      top: 14px;
      right: 14px;
      padding: 10px 18px;
      background: #1a56db;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      z-index: 1000;
    }
    .print-button:hover { background: #1e40af; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  <div class="container">
    <div class="header">
      <div>
        <h1>Missing Items Report</h1>
        <div class="subtitle">Items on this sales order not yet added to any delivery permit</div>
      </div>
      <div class="generated-at">Generated: ${escapeHtml(generatedAt)}</div>
    </div>

    <div class="info-grid">
      <div><span class="label">Sales Order #:</span> <span class="value">${escapeHtml(so.so_number)}</span></div>
      <div><span class="label">Customer:</span> <span class="value">${escapeHtml(customerName)}</span></div>
      <div><span class="label">Order Date:</span> <span class="value">${formatDate(so.order_date)}</span></div>
      <div><span class="label">Delivery Date:</span> <span class="value">${formatDate(so.delivery_date)}</span></div>
      <div><span class="label">Order Status:</span> <span class="value">${escapeHtml(so.status)}</span></div>
      <div><span class="label">Delivery Permits Issued:</span> <span class="value">${(permits || []).length}</span></div>
    </div>

    ${
      missingItems.length === 0
        ? `<div class="empty-state">✅ No missing items — every line item on this order has already been added to a delivery permit.</div>`
        : `
    <table>
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 26%;">Item</th>
          <th style="width: 8%;">Type</th>
          <th style="width: 14%;">Supplier</th>
          <th style="width: 10%;">Unit Cost</th>
          <th style="width: 8%;">Ordered</th>
          <th style="width: 8%;">Missing</th>
          <th style="width: 22%;">Procurement Status</th>
        </tr>
      </thead>
      <tbody>
        ${missingItems
          .map((item, index) => {
            let badgeClass = "badge-needs-po"
            if (item.procurementStatus.startsWith("Ordered")) badgeClass = "badge-ordered"
            else if (item.procurementStatus.startsWith("Rejected")) badgeClass = "badge-rejected"
            else if (item.procurementStatus.startsWith("Stock")) badgeClass = "badge-stock"

            return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.itemName)}${item.sku !== "-" ? `<div style="color:#9ca3af;font-size:10px;">SKU: ${escapeHtml(item.sku)}</div>` : ""}</td>
          <td><span class="type-tag ${item.isOutsourced ? "type-outsourced" : "type-stock"}">${item.isOutsourced ? "Outsourced" : "Stock"}</span></td>
          <td>${escapeHtml(item.supplierName)}</td>
          <td>${formatCurrency(item.unitPrice)}</td>
          <td>${item.orderedQty}</td>
          <td style="font-weight:700;color:#b45309;">${item.missingQty}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(item.procurementStatus)}</span></td>
        </tr>`
          })
          .join("")}
      </tbody>
    </table>
    <div class="totals">
      Total value of missing items: <span class="value">${formatCurrency(totalMissingValue)}</span>
    </div>
    `
    }
  </div>
</body>
</html>`

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (error) {
    console.error("Missing items PDF error:", error)
    return errorPage("Failed to Generate Report", "An unexpected error occurred while generating the missing items report.", 500)
  }
}
