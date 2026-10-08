import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { VAT_RATE, computeInvoiceAmount, computeWholeOrderAmount, loadSoInvoicingState, round2 } from "@/lib/invoicing"
import { lineKey, loadReturnLines, netLineQuantities, returnedByKey, toMs } from "@/lib/return-lines"

export const dynamic = "force-dynamic"

// Format date with English numbers
function formatInvoiceDate(dateStr: string): string {
  if (!dateStr) return "-"
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

// Format number with English numerals
function formatEnglishNumber(num: number | string): string {
  return String(num)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    
    const invoiceId = Number.parseInt(id)

    if (!id || !invoiceId || isNaN(invoiceId)) {
      console.error("AR Invoice PDF - Invalid invoice ID. Raw:", id, "Parsed:", invoiceId)
      return NextResponse.json({ error: "Invalid invoice ID", details: { received: id, parsed: invoiceId } }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch AR invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_receivable")
      .select(`
        *,
        customers:customer_id (customer_name, phone, address, city),
        sales_orders:so_id (
          so_id,
          so_number,
          order_date,
          total,
          subtotal,
          discount_amount,
          payment_type,
          payment_terms,
          quotation_request_number,
          quotation_request_file_name,
          department_name,
          receiver_name,
          delivery_contact_name,
          delivery_contact_phone,
          sales_order_items (
            product_id,
            quantity,
            unit_price,
            total,
            item_type,
            outsourced_name,
            products:product_id (product_name, sku)
          )
        )
      `)
      .eq("invoice_id", invoiceId)
      .single()

    if (invoiceError || !invoice) {
      console.error("AR Invoice PDF - Invoice not found:", invoiceId, invoiceError)
      return new NextResponse(generateErrorHtml("فاتورة العميل غير موجودة", `Invoice ID: ${id}`), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const customer = invoice.customers || {}
    const so = invoice.sales_orders || {}
    const qrNumber = so.quotation_request_number || null

    // A single sales order can have multiple delivery permits, each invoiced
    // separately. Find the delivery permit(s) actually linked to THIS invoice
    // (via invoice_delivery_permits) - if any exist, this invoice only covers
    // those DPs' items, not every item on the whole sales order.
    const { data: dpLinks } = await supabase
      .from("invoice_delivery_permits")
      .select(
        `
        permit_id,
        delivery_permits:permit_id (
          permit_id,
          permit_no,
          status,
          delivery_permit_items (
            product_id,
            quantity,
            unit_price,
            total,
            item_name_snapshot
          )
        )
      `,
      )
      .eq("invoice_id", invoiceId)

    const linkedPermits = (dpLinks || []).map((link: any) => link.delivery_permits).filter(Boolean)
    const isDpBasedInvoice = linkedPermits.length > 0

    // Items shown on the invoice: only the linked DP's items for a DP-based
    // invoice, otherwise every item on the sales order (invoice created
    // directly from the SO with no specific DP subset).
    // Batch 2: a delivery-permit invoice was priced net of the returns that existed when it was created
    // (lib/invoicing.ts), so the printed lines must be net of the same returns. Returns filed after the invoice
    // never change it. With no such returns the lines are exactly what they were before.
    const invoiceMs = toMs(invoice.created_at)
    const returnLines = isDpBasedInvoice ? await loadReturnLines(supabase, linkedPermits.map((p: any) => p.permit_id)) : []
    let items = isDpBasedInvoice
      ? linkedPermits.flatMap((permit: any) => {
          const rows: any[] = permit.delivery_permit_items || []
          const net = netLineQuantities(
            rows.map((row) => ({ key: lineKey(row.product_id, row.item_name_snapshot), quantity: Number(row.quantity) || 0 })),
            returnedByKey(returnLines, { permitId: permit.permit_id, asOfMs: Number.isNaN(invoiceMs) ? Number.NEGATIVE_INFINITY : invoiceMs }),
          )
          return rows
            .map((item: any, idx: number) => {
              const originalQty = Number(item.quantity) || 0
              const unchanged = net[idx] === originalQty
              const lineTotal = Number(item.total) || (Number(item.unit_price) || 0) * originalQty
              return {
                quantity: unchanged ? item.quantity : net[idx],
                unit_price: item.unit_price,
                total: unchanged ? item.total : originalQty > 0 ? (lineTotal * net[idx]) / originalQty : 0,
                item_type: null,
                outsourced_name: null,
                products: { product_name: item.item_name_snapshot },
              }
            })
            .filter((item: any) => Number(item.quantity) > 0)
        })
      : invoice.sales_orders?.sales_order_items || []

    // Batch 2: a whole-order invoice leaves out the quantity returned before it was created, so its printed lines
    // must too (the stored amount is already net). With no such returns the lines are exactly the order's lines.
    if (!isDpBasedInvoice && invoice.so_id) {
      const state = await loadSoInvoicingState(supabase, invoice.so_id)
      if (state && state.returns.length > 0) {
        const asOf = Number.isNaN(invoiceMs) ? Number.NEGATIVE_INFINITY : invoiceMs
        const priced = computeWholeOrderAmount({ ...state, returns: state.returns.filter((r) => toMs(r.created_at) <= asOf) })
        if (priced.ok && priced.excluded.size > 0) {
          const left = new Map(priced.excluded)
          for (let i = 0; i < items.length; i++) {
            const item: any = items[i]
            const key = lineKey(item.product_id, item.outsourced_name)
            const qty = Number(item.quantity) || 0
            const take = Math.min(left.get(key) || 0, qty)
            if (take <= 0) continue
            left.set(key, (left.get(key) || 0) - take)
            const lineTotal = Number(item.total) || (Number(item.unit_price) || 0) * qty
            items[i] = { ...item, quantity: qty - take, total: qty > 0 ? (lineTotal * (qty - take)) / qty : 0 }
          }
          items = items.filter((item: any) => Number(item.quantity) > 0)
        }
      }
    }

    // Delivery permits listed in the invoice header: only the ones linked to
    // THIS invoice, not every DP ever created for the sales order.
    const deliveryPermits = isDpBasedInvoice
      ? linkedPermits.map((permit: any) => ({
          permit_id: permit.permit_id,
          permit_no: permit.permit_no,
          status: permit.status,
        }))
      : []

    // Calculate totals - ensure proper numeric conversion
    // Do all math calculations FIRST with JavaScript numbers, then convert to Arabic for display
    const rawItemsTotal = items.reduce((sum: number, item: any) => {
      const unitPrice = Number(item.unit_price) || 0
      const quantity = Number(item.quantity) || 0
      const itemTotal = Number(item.total) || (unitPrice * quantity)
      return sum + itemTotal
    }, 0)

    // The printed total must equal the stored invoice amount.
    //  - Delivery-permit invoice: priced from the linked permits' items with the sales order's discount rate
    //    and 14% VAT - the same shared function create-from-dps stores (lib/invoicing.ts).
    //  - Whole-sales-order invoice: the stored amount (the sales order total) is authoritative.
    const soSubtotal = Number(so.subtotal) || 0
    const soDiscount = Number(so.discount_amount) || 0
    const discountRate = soSubtotal > 0 ? soDiscount / soSubtotal : 0
    const VAT_RATE_PDF = 1 + VAT_RATE

    const totalWithVat = isDpBasedInvoice
      ? computeInvoiceAmount(rawItemsTotal, soSubtotal, soDiscount)
      : round2(Number(invoice.amount) || 0)
    // Rounded to cents so the piastre column never shows 100 (e.g. 899.9999 -> "899 / 100").
    const subtotalBeforeVat = round2(isDpBasedInvoice ? rawItemsTotal * (1 - discountRate) : totalWithVat / VAT_RATE_PDF)
    const vatAmount = round2(totalWithVat - subtotalBeforeVat)

    // Fetch logo and convert to base64 for embedding in HTML
    let logoDataUrl = ""
    try {
      const baseUrl = request.nextUrl.origin
      const logoResponse = await fetch(`${baseUrl}/images/image.png`)
      if (logoResponse.ok) {
        const logoBuffer = await logoResponse.arrayBuffer()
        const base64 = Buffer.from(logoBuffer).toString("base64")
        logoDataUrl = `data:image/png;base64,${base64}`
      }
    } catch (e) {
      console.error("Failed to load logo:", e)
    }

    // Generate HTML invoice
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>فاتورة - ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @page { size: A4; margin: 15mm; }
    
    body {
      font-family: 'Noto Naskh+Arabic', 'Arial', sans-serif;
      font-size: 12pt;
      line-height: 1.4;
      color: #000;
      background: white;
      direction: rtl;
    }
    
    /* NO modern UI - plain paper form style */
    table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
    }
    
    th, td {
      border: 1px solid #000;
      padding: 8px;
      text-align: right;
    }
    
    th {
      background: #f0f0f0;
      font-weight: 700;
    }
    
    .header-table {
      width: 100%;
      border: 2px solid #000;
      margin-bottom: 10mm;
    }
    
    .header-table td {
      border: 1px solid #000;
      padding: 4px 8px;
    }
    
    .company-header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding: 10px;
      margin-bottom: 5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .company-logo {
      width: 80px;
      height: 80px;
      object-fit: contain;
      margin-bottom: 10px;
    }
    
    .company-name-ar {
      font-size: 18pt;
      font-weight: 700;
      margin-bottom: 3px;
    }
    
    .company-name-en {
      font-size: 14pt;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .company-details {
      font-size: 10pt;
      line-height: 1.6;
    }
    
    .tax-info {
      font-size: 9pt;
      margin-top: 5px;
      border-top: 1px solid #ccc;
      padding-top: 5px;
    }
    
    .doc-title {
      text-align: center;
      font-size: 20pt;
      font-weight: 700;
      margin: 10mm 0;
      text-decoration: underline;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0;
      margin-bottom: 10mm;
    }
    
    .info-cell {
      border: 1px solid #000;
      padding: 6px 10px;
      display: flex;
      gap: 10px;
    }
    
    .info-label {
      font-weight: 700;
      min-width: 100px;
    }
    
    /* Items table with جنيه/قرش columns */
    .items-table {
      width: 100%;
      border: 2px solid #000;
      margin-bottom: 10mm;
    }
    
    .items-table th {
      background: #e8e8e8;
      font-weight: 700;
      text-align: center;
      padding: 8px 4px;
    }
    
    .items-table td {
      text-align: right;
      padding: 6px 4px;
    }
    
    .items-table .center {
      text-align: center;
    }
    
    /* Currency split columns */
    .currency-col {
      text-align: center;
    }
    
    .currency-header {
      text-align: center;
    }
    
    .subheader {
      font-size: 10pt;
      font-weight: 600;
    }
    
    .footer-section {
      margin-top: 15mm;
      border-top: 2px solid #000;
      padding-top: 10mm;
    }
    
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20mm;
      margin-top: 15mm;
    }
    
    .signature-box {
      text-align: center;
    }
    
    .signature-label {
      font-weight: 700;
      margin-bottom: 20mm;
      text-decoration: underline;
    }
    
    .signature-line {
      border-top: 1px solid #000;
      margin-top: 15mm;
    }
    
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; padding: 0; }
    }
    
    .print-button {
      position: fixed;
      top: 10px;
      left: 10px;
      padding: 10px 20px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ طباعة</button>
  
  <!-- Company Header -->
  <div class="company-header">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="company-logo" />` : `<div style="font-size: 28px; font-weight: bold; color: #1a56db; margin-bottom: 10px;">مصر موتورز</div>`}
    <div class="company-name-ar">${COMPANY_SETTINGS.nameAr}</div>
    <div class="company-name-en">${COMPANY_SETTINGS.nameEn}</div>
    <div class="company-details">
      <div>العنوان: ${COMPANY_SETTINGS.address}</div>
      <div>تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}</div>
      <div>البريد الإلكتروني: ${COMPANY_SETTINGS.email}</div>
    </div>
    <div class="tax-info">${getTaxInfo()}</div>
  </div>
  
  <!-- Document Title -->
  <div class="doc-title">فاتورة</div>
  
  <!-- Invoice Info -->
  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم الفاتورة:</strong></td>
      <td style="width: 25%;">${escapeHtml(invoice.invoice_number)}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td>
      <td style="width: 25%;">${formatInvoiceDate(invoice.invoice_date)}</td>
    </tr>
    ${
      qrNumber
        ? `<tr>
      <td style="width: 25%;"><strong>رقم طلب التسعير:</strong></td>
      <td colspan="3">${escapeHtml(qrNumber)}</td>
    </tr>`
        : ""
    }
    ${
      deliveryPermits.length > 0
        ? `<tr>
      <td style="width: 25%;"><strong>أذونات التسليم:</strong></td>
      <td colspan="3">${deliveryPermits.map((dp: any) => escapeHtml(dp.permit_no)).join(" - ")}</td>
    </tr>`
        : ""
    }
    <tr>
      <td colspan="4">
        <strong>المطلوب من السيد:</strong> ${escapeHtml(customer.customer_name || "-")}
      </td>
    </tr>
    ${
      so.department_name
        ? `<tr>
      <td colspan="4">
        <strong>القسم ورقم طلب التسعير:</strong> ${escapeHtml(so.department_name)}
      </td>
    </tr>`
        : ""
    }
    ${
      so.receiver_name || so.delivery_contact_name
        ? `<tr>
      <td colspan="4">
        <strong>اسم المستلم:</strong> ${escapeHtml(so.receiver_name || so.delivery_contact_name)}${so.delivery_contact_phone ? ` - تليفون: ${escapeHtml(so.delivery_contact_phone)}` : ""}
      </td>
    </tr>`
        : ""
    }
    <tr>
      <td colspan="4">
        <strong>العنوان:</strong> ${escapeHtml(customer.address || "-")}, ${escapeHtml(customer.city || "-")}
      </td>
    </tr>
  </table>
  
  <!-- Items Table - EXACT COLUMNS -->
  <table class="items-table">
    <thead>
      <tr>
        <th rowspan="2" style="width: 8%;">عدد</th>
        <th rowspan="2" style="width: 40%;">البيان</th>
        <th colspan="2" class="currency-header">سعر الوحدة</th>
        <th colspan="2" class="currency-header">القيمة</th>
      </tr>
      <tr>
        <th class="subheader" style="width: 13%;">جنيه</th>
        <th class="subheader" style="width: 13%;">قرش</th>
        <th class="subheader" style="width: 13%;">جنيه</th>
        <th class="subheader" style="width: 13%;">قرش</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map((item: any) => {
          const unitPrice = Number(item.unit_price) || 0
          const quantity = Number(item.quantity) || 0
          const itemTotal = Number(item.total) || (unitPrice * quantity)
          const unitGineh = Math.floor(unitPrice)
          const unitQirsh = Math.round((unitPrice - unitGineh) * 100)
          const totalGineh = Math.floor(itemTotal)
          const totalQirsh = Math.round((itemTotal - totalGineh) * 100)
          
          // Get item name - use outsourced_name for outsourced items, product_name for stock items
          const itemName = item.item_type === 'outsourced' 
            ? (item.outsourced_name || 'صنف خارجي') 
            : (item.products?.product_name || '-')

          return `
        <tr>
          <td class="center">${quantity}</td>
          <td>${escapeHtml(itemName)}</td>
          <td class="currency-col">${unitGineh.toLocaleString('en-US')}</td>
          <td class="currency-col">${unitQirsh.toString().padStart(2, '0')}</td>
          <td class="currency-col">${totalGineh.toLocaleString('en-US')}</td>
          <td class="currency-col">${totalQirsh.toString().padStart(2, '0')}</td>
        </tr>
      `
        })
        .join("")}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align: left;">المجموع الفرعي</td>
        <td class="currency-col">${Math.floor(subtotalBeforeVat).toLocaleString('en-US')}</td>
        <td class="currency-col">${Math.round((subtotalBeforeVat - Math.floor(subtotalBeforeVat)) * 100).toString().padStart(2, '0')}</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align: left;">ضريبة القيمة المضافة (14%)</td>
        <td class="currency-col">${Math.floor(vatAmount).toLocaleString('en-US')}</td>
        <td class="currency-col">${Math.round((vatAmount - Math.floor(vatAmount)) * 100).toString().padStart(2, '0')}</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align: left; font-weight: 700;">إجمالي الفاتورة</td>
        <td class="currency-col" style="font-weight: 700;">${Math.floor(totalWithVat).toLocaleString('en-US')}</td>
        <td class="currency-col" style="font-weight: 700;">${Math.round((totalWithVat - Math.floor(totalWithVat)) * 100).toString().padStart(2, '0')}</td>
      </tr>
    </tfoot>
  </table>
  
  <!-- Footer -->
  <div class="signatures">
    <div class="signature-box">
      <div class="signature-label">الحسابات</div>
      <div class="signature-line"></div>
    </div>
    <div class="signature-box">
      <div class="signature-label">توقيع المستلم</div>
      <div class="signature-line"></div>
    </div>
    <div class="signature-box">
      <div class="signature-label">ختم الشركة</div>
      <div class="signature-line"></div>
    </div>
  </div>
</body>
</html>
    `

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    console.error("AR Invoice PDF error:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}

function generateErrorHtml(title: string, details: string): string {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>خطأ</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f3f4f6; }
    .error-box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
    h1 { color: #16a34a; }
    .details { font-size: 12px; color: #9ca3af; background: #f9fafb; padding: 10px; border-radius: 5px; margin-top: 15px; }
    button { background: #16a34a; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>⚠️ ${escapeHtml(title)}</h1>
    <div class="details">${escapeHtml(details)}</div>
    <button onclick="window.close()">إغلاق</button>
  </div>
</body>
</html>
  `
}
