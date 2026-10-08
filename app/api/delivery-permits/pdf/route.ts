import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"

export const dynamic = "force-dynamic"

// Numbers formatter - returns English (Western) numerals to avoid calculation issues
function toArabicNumbers(num: number | string): string {
  return String(num)
}

// Format date in Arabic
function formatArabicDate(dateStr: string): string {
  const date = new Date(dateStr)
  const day = toArabicNumbers(date.getDate())
  const month = toArabicNumbers(date.getMonth() + 1)
  const year = toArabicNumbers(date.getFullYear())
  return `${day}/${month}/${year}`
}

// Format currency in Arabic
function formatArabicCurrency(amount: number): string {
  return `${toArabicNumbers(amount.toLocaleString())} ج.م`
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const permitId = searchParams.get("permit_id") || searchParams.get("permitId")


    if (!permitId) {
      return NextResponse.json({ error: "Permit ID is required" }, { status: 400 })
    }

    const supabase = createAdminClient()


    // Fetch permit with all related data
    const { data: permit, error: permitError } = await withRetry(() =>
      supabase
        .from("delivery_permits")
        .select(
          `
          *,
          sales_orders (
            so_number,
            total,
            order_date,
            delivery_date,
            quotation_request_number,
            delivery_address,
            delivery_contact_name,
            delivery_contact_phone
          ),
          customers (
            customer_name,
            phone,
            address,
            city,
            country
          )
        `,
        )
        .eq("permit_id", Number.parseInt(permitId))
        .single(),
    )

    if (permitError || !permit) {
      console.error("Permit not found:", permitId, permitError)
      const errorHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>خطأ - إذن التسليم غير موجود</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f3f4f6;
    }
    .error-box {
      background: white;
      padding: 40px;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    h1 { color: #dc2626; margin-bottom: 10px; }
    p { color: #4b5563; margin-bottom: 20px; }
    .debug { font-size: 12px; color: #9ca3af; background: #f9fafb; padding: 10px; border-radius: 5px; }
    button {
      background: #2563eb;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>⚠️ خطأ</h1>
    <p>لم يتم العثور على إذن التسليم</p>
    <div class="debug">
      <p>Permit ID: ${escapeHtml(permitId)}</p>
      <p>Error: ${escapeHtml(permitError?.message || "Not found")}</p>
    </div>
    <br>
    <button onclick="window.close()">إغلاق</button>
  </div>
</body>
</html>
      `
      return new NextResponse(errorHtml, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }


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

    // Fetch permit items
    const { data: items } = await withRetry(() =>
      supabase.from("delivery_permit_items").select("*").eq("permit_id", Number.parseInt(permitId)),
    )

    // Generate HTML for PDF (Arabic RTL)
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>إذن تسليم - ${escapeHtml(permit.permit_no)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @page { size: A4; margin: 15mm; }
    
    body {
      font-family: 'Noto Naskh Arabic', 'Arial', sans-serif;
      font-size: 12pt;
      line-height: 1.4;
      color: #000;
      background: white;
      direction: rtl;
    }
    
    /* Paper form style - NO modern UI */
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
      text-align: center;
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
    
    .header-table {
      width: 100%;
      border: 2px solid #000;
      margin-bottom: 10mm;
    }
    
    .header-table td {
      border: 1px solid #000;
      padding: 6px 10px;
    }
    
    .items-table {
      width: 100%;
      border: 2px solid #000;
      margin-bottom: 10mm;
    }
    
    .items-table th, .items-table td {
      text-align: center;
      padding: 8px 4px;
    }
    
    .items-table td.description {
      text-align: right;
    }
    
    .footer-section {
      margin-top: 15mm;
      border: 2px solid #000;
      padding: 10mm;
    }
    
    .footer-text {
      text-align: center;
      font-weight: 700;
      margin-bottom: 10mm;
      font-size: 11pt;
    }
    
    .note-text {
      font-size: 10pt;
      margin-bottom: 8mm;
    }
    
    .signature-date {
      display: flex;
      justify-content: space-between;
      margin-bottom: 15mm;
    }
    
    .signature-area {
      margin-top: 10mm;
      text-align: center;
    }
    
    .signature-line {
      border-top: 1px solid #000;
      width: 200px;
      margin: 20mm auto 5mm;
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
  <div class="doc-title">إذن تسليم</div>
  
  <!-- DP Info -->
  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم إذن تسليم (DP):</strong></td>
      <td style="width: 25%;">${escapeHtml(permit.permit_no)}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td>
      <td style="width: 25%;">${formatArabicDate(permit.created_at || new Date().toISOString())}</td>
    </tr>
    <tr>
      <td style="width: 25%;"><strong>رقم أمر البيع (SO):</strong></td>
      <td style="width: 25%;">${escapeHtml(permit.sales_orders?.so_number || "-")}</td>
      <td style="width: 25%;"><strong>رقم طلب العرض (QR):</strong></td>
      <td style="width: 25%;">${escapeHtml(permit.sales_orders?.quotation_request_number || permit.qr_number || "-")}</td>
    </tr>
    <tr>
      <td colspan="4">
        <strong>يسلم إلى:</strong> ${escapeHtml(permit.recipient_name || permit.sales_orders?.delivery_contact_name || permit.customers?.customer_name || "-")}
      </td>
    </tr>
    <tr>
      <td colspan="2">
        <strong>العنوان:</strong> ${escapeHtml(permit.delivery_address || permit.sales_orders?.delivery_address || permit.customers?.address || "-")}
      </td>
      <td colspan="2">
        <strong>تليفون:</strong> ${escapeHtml(permit.recipient_phone || permit.sales_orders?.delivery_contact_phone || permit.customers?.phone || "-")}
      </td>
    </tr>
  </table>
  
  <!-- Items Table - EXACT COLUMNS -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 8%;">مسلسل</th>
        <th style="width: 10%;">عدد</th>
        <th style="width: 42%;">البيان</th>
        <th style="width: 20%;">رقم الصنف</th>
        <th style="width: 20%;">ملاحظات</th>
      </tr>
    </thead>
    <tbody>
      ${(items || [])
        .map(
          (item: any, index: number) => `
        <tr>
          <td>${toArabicNumbers(index + 1)}</td>
          <td>${escapeHtml(toArabicNumbers(item.quantity))}</td>
          <td class="description">${escapeHtml(item.item_name_snapshot || "-")}</td>
          <td>${escapeHtml(item.sku_snapshot || "-")}</td>
          <td></td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  </table>
  
  <!-- Footer Section -->
  <div class="footer-section">
    <div class="footer-text">
      استلمت المواد المذكورة أعلاه في حالة جيدة
    </div>
    <div class="note-text">
      <strong>ملاحظة:</strong> التوقيع يشمل الموافقة على شروط البيع خلفه
    </div>
    <div class="signature-date">
      <div><strong>تحريرًا في:</strong> _______________</div>
      <div><strong>توقيع المستلم:</strong> _______________</div>
    </div>
  </div>
</body>
</html>
    `

    // Return HTML (can be converted to PDF client-side or via a service)
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error) {
    console.error("Delivery Permit PDF error:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}
