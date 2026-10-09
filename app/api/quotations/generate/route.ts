import { type NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle } from "@/lib/print/print-theme"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dataParam = searchParams.get("data")
    const quotationNumber = searchParams.get("qn") || `QT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`

    if (!dataParam) {
      return NextResponse.json({ error: "Missing quotation data" }, { status: 400 })
    }

    const {
      customer_name,
      customer_email,
      customer_phone,
      items,
      validity_days = 30,
      notes,
    } = JSON.parse(decodeURIComponent(dataParam))


    if (!customer_name || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = getAdminClient()
    const productIds = items.map((item: any) => item.product_id)
    const { data: products } = await supabase
      .from("products")
      .select("product_id, product_name, unit_price")
      .in("product_id", productIds)

    const quotationItems = items.map((item: any) => {
      const product = products?.find((p) => p.product_id === item.product_id)
      const unitPrice = item.unit_price || product?.unit_price || 0
      const quantity = item.quantity || 0
      const itemTotal = quantity * unitPrice
      
      return {
        product_name: item.product_name || product?.product_name || "Unknown Product",
        quantity: quantity,
        unit_price: unitPrice,
        total: itemTotal,
      }
    })

    // Calculate pre-tax subtotal, then add VAT
    const subtotal = quotationItems.reduce((sum, item) => sum + item.total, 0)
    const tax = subtotal * 0.14
    const total = subtotal + tax
    
    // Use English date format to avoid Arabic numerals that show as 2022
    const quotationDate = new Date().toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' })
    const validUntil = new Date(Date.now() + validity_days * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' })
    
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

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>عرض سعر - ${escapeHtml(quotationNumber)}</title>
  <style>
    ${PRINT_CSS}
    .print-btn { position: fixed; top: 10px; left: 10px; padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 5px; cursor: pointer; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">طباعة / Print</button>
  ${printHeader({
    logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" class="logo">` : `<div style="font-size: 24px; font-weight: bold; color: #1a56db;">مصر موتورز</div>`}`,
    company: {
      nameAr: `${COMPANY_SETTINGS.company_name_ar}`,
      nameEn: `${COMPANY_SETTINGS.company_name_en}`,
      detailsHtml: `${COMPANY_SETTINGS.address_ar}<br>
      تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}<br>
      البريد الإلكتروني: ${COMPANY_SETTINGS.email}`,
    },
  })}
  ${docTitle({ titleAr: `عرض سعر / Sales Quotation` })}
  <section class="pm-info">
    <div class="pm-fields">
      <div class="pm-field"><div class="pm-label">رقم العرض:</div><div class="pm-value">${escapeHtml(quotationNumber)}</div></div>
      <div class="pm-field"><div class="pm-label">التاريخ:</div><div class="pm-value">${quotationDate}</div></div>
      <div class="pm-field pm-field-wide"><div class="pm-label">العميل:</div><div class="pm-value">${escapeHtml(customer_name)}</div></div>
      ${customer_email ? `<div class="pm-field pm-field-wide"><div class="pm-label">البريد:</div><div class="pm-value">${escapeHtml(customer_email)}</div></div>` : ""}
      ${customer_phone ? `<div class="pm-field pm-field-wide"><div class="pm-label">الهاتف:</div><div class="pm-value">${escapeHtml(customer_phone)}</div></div>` : ""}
      <div class="pm-field pm-field-wide"><div class="pm-label">صالح حتى:</div><div class="pm-value">${validUntil}</div></div>
    </div>
  </section>
  <table class="pm-table items-table">
    <thead><tr><th class="pm-center">م</th><th>اسم الصنف</th><th class="pm-center">الكمية</th><th class="pm-num">سعر الوحدة</th><th class="pm-num">الإجمالي</th></tr></thead>
    <tbody>${quotationItems
      .map(
        (item, i) => `<tr><td class="pm-center">${i + 1}</td><td>${escapeHtml(item.product_name)}</td><td class="pm-center">${escapeHtml(item.quantity.toLocaleString('en-US'))}</td>
      <td class="pm-num">${escapeHtml(item.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} جنيه</td><td class="pm-num">${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>`,
      )
      .join("")}</tbody>
  </table>
  <table class="pm-totals">
    <tr><td><strong>المجموع الفرعي:</strong></td><td class="pm-num">${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>
    <tr><td><strong>ضريبة القيمة المضافة (14%):</strong></td><td class="pm-num">${tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>
    <tr class="pm-total-final"><td><strong>الإجمالي الكلي:</strong></td><td class="pm-num"><strong>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</strong></td></tr>
  </table>
  ${notes ? `<div class="pm-note"><strong>ملاحظات:</strong><br>${escapeHtml(notes)}</div>` : ""}
  <div class="pm-footer"><p>هذا العرض صالح لمدة ${escapeHtml(validity_days)} يوم من تاريخ الإصدار</p>
    <p>نشكركم على ثقتكم في شركة مصر للمحركات</p></div>
</body>
</html>`

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="quotation-${String(quotationNumber).replace(/[^A-Za-z0-9._-]/g, "_")}.html"`,
      },
    })
  } catch (error: any) {
    console.error("Quotation error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
