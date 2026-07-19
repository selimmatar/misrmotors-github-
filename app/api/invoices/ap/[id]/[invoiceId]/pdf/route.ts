import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", minimumFractionDigits: 2 }).format(amount)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
}

export async function GET(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params

  try {
    const supabase = createAdminClient()

    // Fetch invoice + supplier + PO
    const { data: invoice, error } = await supabase
      .from("accounts_payable")
      .select(`
        *,
        suppliers:supplier_id (supplier_name, email, phone, address, city, country),
        purchase_orders:po_id (
          po_number,
          payment_terms,
          payment_type,
          installments,
          monthly_amount,
          down_payment_amount,
          down_payment_due_date,
          order_date
        )
      `)
      .eq("invoice_id", invoiceId)
      .single()

    if (error || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Fetch PO items for line items (this is where item names come from)
    const { data: poItems } = await supabase
      .from("purchase_order_items")
      .select(`
        *,
        products:product_id (product_name, sku)
      `)
      .eq("po_id", invoice.po_id)

    // Fetch company settings
    const { data: settings } = await supabase
      .from("company_settings")
      .select("setting_key, setting_value")

    const getSetting = (key: string) => settings?.find((s: any) => s.setting_key === key)?.setting_value || ""

    const companyName = getSetting("company_name") || "Company Name"
    const companyAddress = getSetting("company_address") || ""
    const companyPhone = getSetting("company_phone") || ""
    const companyEmail = getSetting("company_email") || ""
    const companyLogo = getSetting("company_logo_url") || ""

    const supplier = invoice.suppliers
    const po = invoice.purchase_orders
    const items = poItems || []

    const totalAmount = Number(invoice.amount) || 0
    const paidAmount = Number(invoice.paid_amount) || 0
    const balance = totalAmount - paidAmount

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AP Invoice ${invoice.invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; }
    .page { max-width: 800px; margin: 0 auto; padding: 40px; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #1a1a1a; }
    .company-info h1 { font-size: 22px; font-weight: 700; color: #1a1a1a; }
    .company-info p { font-size: 12px; color: #555; margin-top: 2px; }
    .logo { max-height: 64px; max-width: 180px; object-fit: contain; }
    .invoice-title { text-align: right; }
    .invoice-title h2 { font-size: 28px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
    .invoice-title .invoice-number { font-size: 14px; color: #555; margin-top: 4px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 6px; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-overdue { background: #fee2e2; color: #991b1b; }
    .badge-partial { background: #dbeafe; color: #1e40af; }

    /* Meta grid */
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
    .meta-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
    .meta-box h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; margin-bottom: 10px; letter-spacing: 0.05em; }
    .meta-box p { font-size: 13px; color: #1a1a1a; line-height: 1.6; }
    .meta-box p span { color: #6b7280; font-size: 12px; }

    /* Details row */
    .details-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .detail-cell { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
    .detail-cell .label { font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .detail-cell .value { font-size: 13px; font-weight: 600; color: #1a1a1a; }

    /* Items table */
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead th { background: #1a1a1a; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    thead th:last-child { text-align: right; }
    tbody tr { border-bottom: 1px solid #e5e7eb; }
    tbody tr:last-child { border-bottom: none; }
    tbody td { padding: 10px 12px; font-size: 13px; color: #1a1a1a; vertical-align: top; }
    tbody td:last-child { text-align: right; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .item-name { font-weight: 500; }
    .item-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }

    /* Totals */
    .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 28px; }
    .totals-box { width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .totals-row:last-child { border-bottom: none; }
    .totals-row.total { font-weight: 700; font-size: 14px; }
    .totals-row.balance { font-weight: 700; font-size: 15px; color: #dc2626; }
    .totals-row.paid { color: #059669; }

    /* Footer */
    .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; text-align: center; font-size: 11px; color: #9ca3af; }

    @media print {
      body { font-size: 12px; }
      .page { padding: 20px; }
      @page { margin: 10mm; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="company-info">
      ${companyLogo ? `<img src="${companyLogo}" class="logo" alt="Logo" />` : `<h1>${companyName}</h1>`}
      ${companyLogo ? `<p style="margin-top:6px;font-weight:600;">${companyName}</p>` : ""}
      ${companyAddress ? `<p>${companyAddress}</p>` : ""}
      ${companyPhone ? `<p>${companyPhone}</p>` : ""}
      ${companyEmail ? `<p>${companyEmail}</p>` : ""}
    </div>
    <div class="invoice-title">
      <h2>PURCHASE INVOICE</h2>
      <div class="invoice-number">${invoice.invoice_number || "—"}</div>
      <span class="badge badge-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : invoice.status === "partially_paid" ? "partial" : "pending"}">
        ${invoice.status?.replace("_", " ") || "Pending"}
      </span>
    </div>
  </div>

  <!-- Meta: From / To -->
  <div class="meta-grid">
    <div class="meta-box">
      <h3>From (Supplier)</h3>
      <p style="font-weight:600;font-size:14px;">${supplier?.supplier_name || "—"}</p>
      ${supplier?.email ? `<p><span>Email: </span>${supplier.email}</p>` : ""}
      ${supplier?.phone ? `<p><span>Phone: </span>${supplier.phone}</p>` : ""}
      ${supplier?.address ? `<p>${supplier.address}${supplier.city ? ", " + supplier.city : ""}${supplier.country ? ", " + supplier.country : ""}</p>` : ""}
    </div>
    <div class="meta-box">
      <h3>Billed To</h3>
      <p style="font-weight:600;font-size:14px;">${companyName}</p>
      ${companyAddress ? `<p>${companyAddress}</p>` : ""}
      ${companyPhone ? `<p>${companyPhone}</p>` : ""}
      ${companyEmail ? `<p>${companyEmail}</p>` : ""}
    </div>
  </div>

  <!-- Details row -->
  <div class="details-row">
    <div class="detail-cell">
      <div class="label">Invoice Date</div>
      <div class="value">${formatDate(invoice.invoice_date)}</div>
    </div>
    <div class="detail-cell">
      <div class="label">Due Date</div>
      <div class="value">${formatDate(invoice.due_date)}</div>
    </div>
    <div class="detail-cell">
      <div class="label">PO Number</div>
      <div class="value">${po?.po_number || "—"}</div>
    </div>
    <div class="detail-cell">
      <div class="label">Payment Type</div>
      <div class="value">${(invoice.payment_type || po?.payment_type || "—").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</div>
    </div>
  </div>

  <!-- Line Items -->
  <div class="section-title">Items</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Type</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.length > 0
        ? items.map((item: any, i: number) => {
            const itemName = item.item_type === "outsourced"
              ? (item.outsourced_name || "Outsourced Item")
              : (item.products?.product_name || item.outsourced_name || "—")
            const sku = item.products?.sku || ""
            const qty = Number(item.quantity) || 0
            const unitPrice = Number(item.unit_price) || 0
            const total = Number(item.total) || qty * unitPrice
            return `<tr>
              <td>${i + 1}</td>
              <td>
                <div class="item-name">${itemName}</div>
                ${sku ? `<div class="item-sub">SKU: ${sku}</div>` : ""}
                ${item.outsourced_description ? `<div class="item-sub">${item.outsourced_description}</div>` : ""}
              </td>
              <td>${item.item_type === "outsourced" ? "Outsourced" : "Product"}</td>
              <td>${qty}</td>
              <td>${formatCurrency(unitPrice)}</td>
              <td>${formatCurrency(total)}</td>
            </tr>`
          }).join("")
        : `<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px;">No items found</td></tr>`
      }
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="totals-row total">
        <span>Invoice Total</span>
        <span>${formatCurrency(totalAmount)}</span>
      </div>
      <div class="totals-row paid">
        <span>Amount Paid</span>
        <span>${formatCurrency(paidAmount)}</span>
      </div>
      <div class="totals-row balance">
        <span>Balance Due</span>
        <span>${formatCurrency(balance)}</span>
      </div>
    </div>
  </div>

  <!-- Payment Terms Note -->
  ${invoice.payment_type === "installments" || po?.payment_type === "installments" ? `
  <div class="meta-box" style="margin-bottom:24px;">
    <h3>Payment Schedule</h3>
    <p>
      ${po?.installments || invoice.installment_months || "—"} monthly installments
      ${invoice.monthly_amount ? `of ${formatCurrency(Number(invoice.monthly_amount))} / month` : ""}
      ${invoice.payment_start_date ? `starting ${formatDate(invoice.payment_start_date)}` : ""}
      ${invoice.down_payment_amount && Number(invoice.down_payment_amount) > 0
        ? `| Down payment: ${formatCurrency(Number(invoice.down_payment_amount))} due ${formatDate(invoice.down_payment_due_date)}`
        : ""}
    </p>
  </div>` : ""}

  <!-- Footer -->
  <div class="footer">
    <p>Generated on ${new Date().toLocaleString("en-GB")} &bull; ${companyName}</p>
  </div>

</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (err: any) {
    console.error("AP PDF error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
