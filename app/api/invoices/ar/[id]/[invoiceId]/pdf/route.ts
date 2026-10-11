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

    // Fetch AR invoice + customer + SO
    const { data: invoice, error } = await supabase
      .from("accounts_receivable")
      .select(`
        *,
        customers:customer_id (customer_name, email, phone, address, city, country),
        sales_orders:so_id (
          so_number,
          payment_type,
          payment_terms,
          installments,
          monthly_amount,
          down_payment_amount,
          down_payment_due_date,
          order_date,
          delivery_address
        )
      `)
      .eq("invoice_id", invoiceId)
      .single()

    if (error || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Fetch line items from linked delivery permits
    let items: any[] = []
    const { data: dpLinks } = await supabase
      .from("invoice_delivery_permits")
      .select("permit_id")
      .eq("invoice_id", invoiceId)

    if (dpLinks && dpLinks.length > 0) {
      const permitIds = dpLinks.map((l: any) => l.permit_id)
      const { data: dpItems } = await supabase
        .from("delivery_permit_items")
        .select(`
          *,
          products:product_id (product_name, sku)
        `)
        .in("permit_id", permitIds)
      items = dpItems || []
    }

    // Fallback: fetch SO items if no DP items
    if (items.length === 0 && invoice.so_id) {
      const { data: soItems } = await supabase
        .from("sales_order_items")
        .select(`
          *,
          products:product_id (product_name, sku)
        `)
        .eq("so_id", invoice.so_id)
      items = soItems || []
    }

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

    const customer = invoice.customers
    const so = invoice.sales_orders

    const totalAmount = Number(invoice.amount) || 0
    const collectedAmount = Number(invoice.collected_amount) || 0
    const balance = totalAmount - collectedAmount

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AR Invoice ${escapeHtml(invoice.invoice_number)}</title>
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
    titleAr: `SALES INVOICE`,
    noteHtml: `<div class="invoice-number">${escapeHtml(invoice.invoice_number || "—")}</div>
      <span class="badge badge-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : invoice.status === "partially_paid" ? "partial" : "pending"}">
        ${escapeHtml(invoice.status?.replace("_", " ") || "Pending")}
      </span>`,
  })}

  <!-- Meta: From / To -->
  <div class="meta-grid">
    <div class="pm-info">
      <h3>From (Seller)</h3>
      <p style="font-weight:600;font-size:14px;">${escapeHtml(companyName)}</p>
      ${companyAddress ? `<p>${escapeHtml(companyAddress)}</p>` : ""}
      ${companyPhone ? `<p>${escapeHtml(companyPhone)}</p>` : ""}
      ${companyEmail ? `<p>${escapeHtml(companyEmail)}</p>` : ""}
    </div>
    <div class="pm-info">
      <h3>Billed To (Customer)</h3>
      <p style="font-weight:600;font-size:14px;">${escapeHtml(customer?.customer_name || "—")}</p>
      ${customer?.email ? `<p><span>Email: </span>${escapeHtml(customer.email)}</p>` : ""}
      ${customer?.phone ? `<p><span>Phone: </span>${escapeHtml(customer.phone)}</p>` : ""}
      ${customer?.address ? `<p>${escapeHtml(customer.address)}${customer.city ? ", " + escapeHtml(customer.city) : ""}${customer.country ? ", " + escapeHtml(customer.country) : ""}</p>` : ""}
      ${so?.delivery_address ? `<p><span>Delivery: </span>${escapeHtml(so.delivery_address)}</p>` : ""}
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
      <div class="pm-label">SO Number</div>
      <div class="pm-value">${escapeHtml(so?.so_number || "—")}</div>
    </div>
    <div class="pm-field">
      <div class="pm-label">Payment Type</div>
      <div class="pm-value">${escapeHtml((invoice.payment_terms || so?.payment_type || "—").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))}</div>
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
            const isOutsourced = !item.product_id || item.item_type === "outsourced"
            const itemName = isOutsourced
              ? (item.outsourced_name || item.item_name_snapshot || "Outsourced Item")
              : (item.products?.product_name || item.item_name_snapshot || "—")
            const sku = item.products?.sku || item.sku_snapshot || ""
            const qty = Number(item.quantity) || 0
            const unitPrice = Number(item.unit_price) || 0
            const total = Number(item.total) || qty * unitPrice
            return `<tr>
              <td>${i + 1}</td>
              <td>
                <div class="item-name">${escapeHtml(itemName)}</div>
                ${sku ? `<div class="item-sub">SKU: ${escapeHtml(sku)}</div>` : ""}
              </td>
              <td>${isOutsourced ? "Outsourced" : "Product"}</td>
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
        <span>Amount Collected</span>
        <span>${formatCurrency(collectedAmount)}</span>
      </div>
      <div class="totals-row balance pm-total-final">
        <span>Balance Due</span>
        <span>${formatCurrency(balance)}</span>
      </div>
  </div>

  <!-- Payment Terms Note -->
  ${(invoice.payment_terms === "installments" || so?.payment_type === "installments") ? `
  <table class="pm-table">
    <thead><tr><th>Payment Schedule</th></tr></thead>
    <tbody><tr><td><p>
      ${escapeHtml(so?.installments || invoice.installment_months || "—")} monthly installments
      ${invoice.monthly_amount || so?.monthly_amount ? `of ${formatCurrency(Number(invoice.monthly_amount || so?.monthly_amount))} / month` : ""}
      ${invoice.payment_start_date ? `starting ${formatDate(invoice.payment_start_date)}` : ""}
      ${so?.down_payment_amount && Number(so.down_payment_amount) > 0
        ? `| Down payment: ${formatCurrency(Number(so.down_payment_amount))} due ${formatDate(so.down_payment_due_date)}`
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
    console.error("AR PDF error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
