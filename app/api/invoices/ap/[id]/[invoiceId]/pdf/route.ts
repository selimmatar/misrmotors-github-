import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle } from "@/lib/print/print-theme"

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
  <title>AP Invoice ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    ${PRINT_CSS}
    .logo { max-height: 64px; max-width: 180px; object-fit: contain; }
    .badge { text-transform: uppercase; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-block: 14px 18px; padding-block-start: 10px; border-block-start: 1.5px solid #000; }
    .pm-info h3 { text-transform: uppercase; }
    .pm-info p { line-height: 1.6; overflow-wrap: anywhere; }
    .pm-info p span { font-size: 12px; color: #555; }
    .pm-field .pm-label { text-transform: uppercase; }
    .section-title { text-transform: uppercase; }
    .pm-table thead th { text-transform: uppercase; }
    .item-name { font-weight: 500; }
    .item-sub { font-size: 11px; color: #555; margin-top: 2px; }
    .totals-row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 6px; }
    .totals-row.total { font-weight: 700; }
    .pm-total-final { padding-block-start: 6px; }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  ${printHeader({
    logoHtml: `${companyLogo ? `<img src="${escapeHtml(companyLogo)}" class="logo" alt="Logo" />` : `<h1>${escapeHtml(companyName)}</h1>`}`,
    company: {
      nameEn: `${companyLogo ? `<p>${escapeHtml(companyName)}</p>` : ""}`,
      detailsHtml: `
        ${companyAddress ? `<p>${escapeHtml(companyAddress)}</p>` : ""}
        ${companyPhone ? `<p>${escapeHtml(companyPhone)}</p>` : ""}
        ${companyEmail ? `<p>${escapeHtml(companyEmail)}</p>` : ""}
      `,
    },
  })}
  ${docTitle({
    titleAr: `PURCHASE INVOICE`,
    noteHtml: `<div class="invoice-number">${escapeHtml(invoice.invoice_number || "—")}</div>
      <span class="badge badge-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : invoice.status === "partially_paid" ? "partial" : "pending"}">
        ${escapeHtml(invoice.status?.replace("_", " ") || "Pending")}
      </span>`,
  })}

  <!-- Meta: From / To -->
  <div class="meta-grid">
    <div class="pm-info">
      <h3>From (Supplier)</h3>
      <p style="font-weight:600;font-size:14px;">${escapeHtml(supplier?.supplier_name || "—")}</p>
      ${supplier?.email ? `<p><span>Email: </span>${escapeHtml(supplier.email)}</p>` : ""}
      ${supplier?.phone ? `<p><span>Phone: </span>${escapeHtml(supplier.phone)}</p>` : ""}
      ${supplier?.address ? `<p>${escapeHtml(supplier.address)}${supplier.city ? ", " + escapeHtml(supplier.city) : ""}${supplier.country ? ", " + escapeHtml(supplier.country) : ""}</p>` : ""}
    </div>
    <div class="pm-info">
      <h3>Billed To</h3>
      <p style="font-weight:600;font-size:14px;">${escapeHtml(companyName)}</p>
      ${companyAddress ? `<p>${escapeHtml(companyAddress)}</p>` : ""}
      ${companyPhone ? `<p>${escapeHtml(companyPhone)}</p>` : ""}
      ${companyEmail ? `<p>${escapeHtml(companyEmail)}</p>` : ""}
    </div>
  </div>

  <!-- Details row -->
  <div class="pm-fields">
    <div class="pm-field">
      <div class="pm-label">Invoice Date</div>
      <div class="pm-value">${formatDate(invoice.invoice_date)}</div>
    </div>
    <div class="pm-field">
      <div class="pm-label">Due Date</div>
      <div class="pm-value">${formatDate(invoice.due_date)}</div>
    </div>
    <div class="pm-field">
      <div class="pm-label">PO Number</div>
      <div class="pm-value">${escapeHtml(po?.po_number || "—")}</div>
    </div>
    <div class="pm-field">
      <div class="pm-label">Payment Type</div>
      <div class="pm-value">${escapeHtml((invoice.payment_type || po?.payment_type || "—").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))}</div>
    </div>
  </div>

  <!-- Line Items -->
  <div class="section-title pm-section-title">Items</div>
  <table class="pm-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Type</th>
        <th class="pm-num">Qty</th>
        <th class="pm-num">Unit Price</th>
        <th class="pm-num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.length > 0
        ? items.map((item: any, i: number) => {
            const itemName = item.item_type === "outsourced"
              ? (item.outsourced_name || "Outsourced Item")
              : (item.products?.product_name || item.item_name_snapshot || item.outsourced_name || "—")
            const sku = item.products?.sku || ""
            const qty = Number(item.quantity) || 0
            const unitPrice = Number(item.unit_price) || 0
            const total = Number(item.total) || qty * unitPrice
            return `<tr>
              <td>${i + 1}</td>
              <td>
                <div class="item-name">${escapeHtml(itemName)}</div>
                ${sku ? `<div class="item-sub">SKU: ${escapeHtml(sku)}</div>` : ""}
                ${item.outsourced_description ? `<div class="item-sub">${escapeHtml(item.outsourced_description)}</div>` : ""}
              </td>
              <td>${item.item_type === "outsourced" ? "Outsourced" : "Product"}</td>
              <td class="pm-num">${qty}</td>
              <td class="pm-num">${formatCurrency(unitPrice)}</td>
              <td class="pm-num">${formatCurrency(total)}</td>
            </tr>`
          }).join("")
        : `<tr><td colspan="6" class="pm-center" style="padding:20px;">No items found</td></tr>`
      }
    </tbody>
  </table>

  <!-- Totals -->
  <div class="pm-totals">
      <div class="totals-row total">
        <span>Invoice Total</span>
        <span>${formatCurrency(totalAmount)}</span>
      </div>
      <div class="totals-row paid">
        <span>Amount Paid</span>
        <span>${formatCurrency(paidAmount)}</span>
      </div>
      <div class="totals-row balance pm-total-final">
        <span>Balance Due</span>
        <span>${formatCurrency(balance)}</span>
      </div>
  </div>

  <!-- Payment Terms Note -->
  ${invoice.payment_type === "installments" || po?.payment_type === "installments" ? `
  <table class="pm-table">
    <thead><tr><th>Payment Schedule</th></tr></thead>
    <tbody><tr><td><p>
      ${escapeHtml(po?.installments || invoice.installment_months || "—")} monthly installments
      ${invoice.monthly_amount ? `of ${formatCurrency(Number(invoice.monthly_amount))} / month` : ""}
      ${invoice.payment_start_date ? `starting ${formatDate(invoice.payment_start_date)}` : ""}
      ${invoice.down_payment_amount && Number(invoice.down_payment_amount) > 0
        ? `| Down payment: ${formatCurrency(Number(invoice.down_payment_amount))} due ${formatDate(invoice.down_payment_due_date)}`
        : ""}
    </p></td></tr></tbody>
  </table>` : ""}

  <!-- Footer -->
  <div class="pm-footer">
    <p>Generated on ${new Date().toLocaleString("en-GB")} &bull; ${escapeHtml(companyName)}</p>
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
