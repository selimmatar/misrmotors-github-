import { type NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"

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
    @media print { body { margin: 0; } }
    body { font-family: Arial, sans-serif; direction: rtl; margin: 20px; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 20px; }
    .logo { max-height: 80px; margin-bottom: 10px; }
    .company-name { font-size: 24px; font-weight: bold; margin: 10px 0; }
    .company-details { font-size: 12px; line-height: 1.6; }
    .quotation-info { margin: 20px 0; }
    .quotation-info table { width: 100%; border-collapse: collapse; }
    .quotation-info td { padding: 8px; border: 1px solid #000; }
    .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .items-table th, .items-table td { border: 1px solid #000; padding: 10px; text-align: center; }
    .items-table th { background-color: #f0f0f0; font-weight: bold; }
    .totals { margin-top: 20px; }
    .totals table { width: 50%; margin-right: auto; border-collapse: collapse; }
    .totals td { padding: 10px; border: 1px solid #000; }
    .totals .total-row { font-weight: bold; background-color: #f0f0f0; }
    .footer { margin-top: 40px; font-size: 12px; text-align: center; border-top: 1px solid #000; padding-top: 10px; }
    .print-btn { position: fixed; top: 10px; left: 10px; padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 5px; cursor: pointer; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">طباعة / Print</button>
  <div class="header">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" class="logo">` : `<div style="font-size: 24px; font-weight: bold; color: #1a56db;">مصر موتورز</div>`}
    <div class="company-name">${COMPANY_SETTINGS.company_name_ar}</div>
    <div class="company-name" style="font-size: 18px;">${COMPANY_SETTINGS.company_name_en}</div>
    <div class="company-details">${COMPANY_SETTINGS.address_ar}<br>
      تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}<br>
      البريد الإلكتروني: ${COMPANY_SETTINGS.email}
    </div>
  </div>
  <h2 style="text-align: center; margin: 20px 0;">عرض سعر / Sales Quotation</h2>
  <div class="quotation-info">
    <table>
      <tr><td style="width: 25%;"><strong>رقم العرض:</strong></td><td style="width: 25%;">${escapeHtml(quotationNumber)}</td>
        <td style="width: 25%;"><strong>التاريخ:</strong></td><td style="width: 25%;">${quotationDate}</td></tr>
      <tr><td><strong>العميل:</strong></td><td colspan="3">${escapeHtml(customer_name)}</td></tr>
      ${customer_email ? `<tr><td><strong>البريد:</strong></td><td colspan="3">${escapeHtml(customer_email)}</td></tr>` : ""}
      ${customer_phone ? `<tr><td><strong>الهاتف:</strong></td><td colspan="3">${escapeHtml(customer_phone)}</td></tr>` : ""}
      <tr><td><strong>صالح حتى:</strong></td><td colspan="3">${validUntil}</td></tr>
    </table>
  </div>
  <table class="items-table">
    <thead><tr><th>م</th><th>اسم الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
    <tbody>${quotationItems
      .map(
        (item, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.quantity.toLocaleString('en-US'))}</td>
      <td>${escapeHtml(item.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} جنيه</td><td>${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>`,
      )
      .join("")}</tbody>
  </table>
  <div class="totals">
    <table>
      <tr><td><strong>المجموع الفرعي:</strong></td><td>${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>
      <tr><td><strong>ضريبة القيمة المضافة (14%):</strong></td><td>${tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>
      <tr class="total-row"><td><strong>الإجمالي الكلي:</strong></td><td><strong>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</strong></td></tr>
    </table>
  </div>
  ${notes ? `<div style="margin-top: 30px; padding: 10px; border: 1px solid #000;"><strong>ملاحظات:</strong><br>${escapeHtml(notes)}</div>` : ""}
  <div class="footer"><p>هذا العرض صالح لمدة ${escapeHtml(validity_days)} يوم من تاريخ الإصدار</p>
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
