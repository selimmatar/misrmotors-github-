import { type NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS } from "@/lib/company-settings"
import { escapeHtml, ltrText } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle, PRINT_ROWS_SCRIPT } from "@/lib/print/print-theme"
import { computeTotals } from "@/lib/print-totals"
import { quoteAddressee } from "@/lib/quotations/addressed-to"
import { cleanPictureUrl, hasPictureColumn, pictureCellHtml, pictureHeadHtml, QUOTE_PICTURE_CSS } from "@/lib/quotations/line-picture"

export const dynamic = "force-dynamic"

/** A saved quotation in the shape the screen sends in ?data= (its lines in their order); null when not found. */
async function savedQuotationData(idParam: string): Promise<any | null> {
  if (!/^\d{1,9}$/.test(idParam) || Number(idParam) < 1) return null
  const db = getAdminClient()
  const { data, error } = await db.from("sales_quotations").select("*").eq("id", Number(idParam)).maybeSingle()
  const q: any = data
  if (error) throw new Error(`load quotation: ${error.message}`)
  if (!q) return null
  const { data: lines, error: linesError } = await db.from("sales_quotation_items").select("*").eq("quotation_id", q.id).order("line_no", { ascending: true })
  if (linesError) throw new Error(`load quotation lines: ${linesError.message}`)
  return {
    quotation_number: String(q.quotation_number ?? q.id),
    created_at: q.created_at,
    customer_name: q.customer_name || "",
    addressed_to: q.addressed_to,
    customer_email: q.customer_email,
    customer_phone: q.customer_phone,
    items: (lines || []).map((l: any) => ({
      product_name: l.product_name,
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      ...(l.image_url ? { image_url: l.image_url } : {}),
    })),
    validity_days: Number(q.validity_days) || 30,
    notes: q.notes,
    discount_type: q.discount_type,
    discount_value: q.discount_value == null ? undefined : Number(q.discount_value),
    discount_amount: q.discount_amount == null ? undefined : Number(q.discount_amount),
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const idParam = searchParams.get("id")
    // ?id=<saved quotation id>: the saved quotation as it is in the database (the "Send to customer" PDF and its
    // signed link, owner request 2026-11-27); otherwise the screen's data in ?data= as before
    const saved = idParam !== null ? await savedQuotationData(idParam) : null
    if (idParam !== null && !saved) return NextResponse.json({ error: "Quotation not found" }, { status: 404 })
    const dataParam = saved ? null : searchParams.get("data")
    const quotationNumber = saved?.quotation_number || searchParams.get("qn") || `QT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`

    if (!saved && !dataParam) {
      return NextResponse.json({ error: "Missing quotation data" }, { status: 400 })
    }

    const {
      customer_name,
      addressed_to,
      customer_email,
      customer_phone,
      items,
      validity_days = 30,
      notes,
      discount_type,
      discount_value,
      discount_amount,
    } = saved || JSON.parse(decodeURIComponent(dataParam!))


    if (!customer_name || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = getAdminClient()
    // Lines from the quotation screen carry their name and price and often no product id: look up only real ids
    const productIds = items.map((item: any) => item.product_id).filter((id: any) => id !== undefined && id !== null && id !== "")
    const { data: products } = productIds.length
      ? await supabase.from("products").select("product_id, product_name, unit_price").in("product_id", productIds)
      : { data: [] as any[] }

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
        // the line's picture (lib/quotations/line-picture.ts); printed in a thumbnail column only when a line has one
        image_url: cleanPictureUrl(item.image_url),
      }
    })
    const showPictures = hasPictureColumn(quotationItems)

    // Pre-tax subtotal, minus the quotation's discount, then 14% VAT: the same arithmetic as the saved quotation
    const { subtotal, discount, netSubtotal, vat: tax, total } = computeTotals({
      subtotal: quotationItems.reduce((sum, item) => sum + item.total, 0),
      discountType: discount_type,
      discountValue: discount_value,
      discountAmount: discount_amount,
    })
    const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    
    // Use English date format to avoid Arabic numerals that show as 2022
    // a saved quotation keeps its own date; the screen's print is dated today
    const issuedMs = saved?.created_at && !Number.isNaN(Date.parse(saved.created_at)) ? Date.parse(saved.created_at) : Date.now()
    const quotationDate = new Date(issuedMs).toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: "Africa/Cairo" })
    const validUntil = new Date(issuedMs + validity_days * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' })
    
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
    @media print { .print-btn { display: none; } }${showPictures ? QUOTE_PICTURE_CSS : ""}
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">طباعة</button>
  ${printHeader({
    logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo" class="logo">` : `<div style="font-size: 24px; font-weight: bold; color: #1a56db;">مصر موتورز</div>`}`,
    company: {
      nameAr: `${COMPANY_SETTINGS.company_name_ar}`,
      nameEn: `${COMPANY_SETTINGS.company_name_en}`,
      detailsHtml: `${COMPANY_SETTINGS.address_ar}<br>
      تليفون: ${ltrText(COMPANY_SETTINGS.phone)} | فاكس: ${ltrText(COMPANY_SETTINGS.fax)}<br>
      البريد الإلكتروني: ${ltrText(COMPANY_SETTINGS.email)}`,
    },
  })}
  ${docTitle({ titleAr: `عرض سعر` })}
  <section class="pm-info">
    <div class="pm-fields">
      <div class="pm-field"><div class="pm-label">رقم العرض:</div><div class="pm-value">${escapeHtml(quotationNumber)}</div></div>
      <div class="pm-field"><div class="pm-label">التاريخ:</div><div class="pm-value">${quotationDate}</div></div>
      <div class="pm-field pm-field-wide"><div class="pm-label">العميل:</div><div class="pm-value">${escapeHtml(quoteAddressee({ addressed_to, customer_name }))}</div></div>
      ${customer_email ? `<div class="pm-field pm-field-wide"><div class="pm-label">البريد:</div><div class="pm-value">${ltrText(customer_email)}</div></div>` : ""}
      ${customer_phone ? `<div class="pm-field pm-field-wide"><div class="pm-label">الهاتف:</div><div class="pm-value">${ltrText(customer_phone)}</div></div>` : ""}
      <div class="pm-field pm-field-wide"><div class="pm-label">صالح حتى:</div><div class="pm-value">${validUntil}</div></div>
    </div>
  </section>
  <table class="pm-table items-table">
    <thead><tr><th class="pm-center">م</th>${pictureHeadHtml(showPictures)}<th>اسم الصنف</th><th class="pm-center">الكمية</th><th class="pm-num">سعر الوحدة</th><th class="pm-num">الإجمالي</th></tr></thead>
    <tbody>${quotationItems
      .map(
        (item, i) => `<tr><td class="pm-center">${i + 1}</td>${pictureCellHtml(showPictures, item.image_url)}<td>${escapeHtml(item.product_name)}</td><td class="pm-center">${escapeHtml(item.quantity.toLocaleString('en-US'))}</td>
      <td class="pm-num">${escapeHtml(item.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} جنيه</td><td class="pm-num">${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</td></tr>`,
      )
      .join("")}</tbody>
  </table>
  <table class="pm-totals">
    <tr><td><strong>المجموع الفرعي:</strong></td><td class="pm-num">${money(subtotal)} جنيه</td></tr>${discount > 0 ? `
    <tr><td><strong>الخصم:</strong></td><td class="pm-num" style="color: red;">-${money(discount)} جنيه</td></tr>
    <tr><td><strong>المجموع بعد الخصم:</strong></td><td class="pm-num">${money(netSubtotal)} جنيه</td></tr>` : ""}
    <tr><td><strong>ضريبة القيمة المضافة (14%):</strong></td><td class="pm-num">${money(tax)} جنيه</td></tr>
    <tr class="pm-total-final"><td><strong>الإجمالي الكلي:</strong></td><td class="pm-num"><strong>${money(total)} جنيه</strong></td></tr>
  </table>
  ${notes ? `<div class="pm-note"><strong>ملاحظات:</strong><br>${escapeHtml(notes)}</div>` : ""}
  <div class="pm-footer"><p>هذا العرض صالح لمدة ${escapeHtml(validity_days)} يوم من تاريخ الإصدار</p>
    <p>نشكركم على ثقتكم في شركة مصر للمحركات</p></div>
${PRINT_ROWS_SCRIPT}
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
