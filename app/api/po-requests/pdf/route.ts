import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get("requestId")

    if (!requestId) {
      return new NextResponse(generateErrorHTML("PO Request ID is required"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    // Fetch PO Request with items and supplier
    const { data: poRequest, error: requestError } = await supabase
      .from("po_requests")
      .select(`
        *,
        suppliers (
          supplier_id,
          supplier_name,
          email,
          phone,
          address,
          city,
          country
        ),
        po_request_items (
          item_id,
          product_id,
          product_name,
          quantity,
          unit,
          notes,
          products (
            product_id,
            product_name,
            sku,
            unit
          )
        )
      `)
      .eq("request_id", Number.parseInt(requestId))
      .single()

    if (requestError || !poRequest) {
      console.error("PO Request PDF fetch error:", requestError)
      return new NextResponse(
        generateErrorHTML(`PO Request not found. ID: ${requestId}`, requestError?.message),
        { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    }

    // Fetch logo and convert to base64
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

    const supplier = poRequest.suppliers || {}
    const items = poRequest.po_request_items || []

    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>طلب عرض أسعار - ${poRequest.request_number}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      background: #fff;
      padding: 20px;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
    }
    
    .print-button {
      position: fixed;
      top: 20px;
      left: 20px;
      padding: 12px 24px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 1000;
    }
    
    .print-button:hover {
      background: #1d4ed8;
    }
    
    @media print {
      .print-button { display: none !important; }
      body { padding: 0; }
    }
    
    .company-header {
      text-align: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    
    .company-logo {
      max-height: 80px;
      margin-bottom: 10px;
    }
    
    .company-name-ar {
      font-size: 28px;
      font-weight: bold;
      color: #1e3a5f;
      margin-bottom: 5px;
    }
    
    .company-name-en {
      font-size: 18px;
      color: #4a5568;
      margin-bottom: 10px;
    }
    
    .company-details {
      font-size: 12px;
      color: #666;
      line-height: 1.8;
    }
    
    .tax-info {
      font-size: 11px;
      color: #666;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
    }
    
    .document-title {
      text-align: center;
      font-size: 24px;
      font-weight: bold;
      color: #1e40af;
      margin: 25px 0;
      padding: 15px;
      background: #eff6ff;
      border-radius: 8px;
    }
    
    .info-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 25px;
      gap: 20px;
    }
    
    .info-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
    }
    
    .info-box h3 {
      font-size: 14px;
      color: #1e40af;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #3b82f6;
    }
    
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    
    .info-label {
      color: #64748b;
      font-weight: 500;
    }
    
    .info-value {
      color: #1e293b;
      font-weight: 600;
    }
    
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    
    .items-table th {
      background: #1e40af;
      color: white;
      padding: 12px 8px;
      text-align: center;
      font-weight: 600;
      font-size: 13px;
    }
    
    .items-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #e5e7eb;
      text-align: center;
    }
    
    .items-table tr:nth-child(even) {
      background: #f8fafc;
    }
    
    .items-table tr:hover {
      background: #eff6ff;
    }
    
    .notes-section {
      background: #fefce8;
      border: 1px solid #fbbf24;
      border-radius: 8px;
      padding: 15px;
      margin: 20px 0;
    }
    
    .notes-section h4 {
      color: #92400e;
      margin-bottom: 8px;
    }
    
    .quotation-request-note {
      background: #f0f9ff;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 20px;
      margin: 25px 0;
      text-align: center;
    }
    
    .quotation-request-note h4 {
      color: #1e40af;
      font-size: 16px;
      margin-bottom: 10px;
    }
    
    .quotation-request-note p {
      color: #1e3a5f;
      margin: 5px 0;
    }
    
    .signature-section {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
    }
    
    .signature-box {
      width: 45%;
      text-align: center;
    }
    
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 60px;
      padding-top: 8px;
      font-weight: 600;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      font-size: 11px;
      color: #666;
    }
  </style>
</head>
<body>
  <button class="print-button" onclick="window.print()">طباعة 🖨️</button>
  
  <div class="container">
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
    <div class="document-title">
      طلب عرض أسعار / Quotation Request
    </div>
    
    <!-- Info Section -->
    <div class="info-section">
      <div class="info-box">
        <h3>بيانات الطلب / Request Details</h3>
        <div class="info-row">
          <span class="info-label">رقم الطلب:</span>
          <span class="info-value">${poRequest.request_number}</span>
        </div>
        <div class="info-row">
          <span class="info-label">تاريخ الطلب:</span>
          <span class="info-value">${new Date(poRequest.request_date || poRequest.created_at).toLocaleDateString("ar-EG")}</span>
        </div>
        ${poRequest.expected_delivery_date ? `
        <div class="info-row">
          <span class="info-label">تاريخ التسليم المتوقع:</span>
          <span class="info-value">${new Date(poRequest.expected_delivery_date).toLocaleDateString("ar-EG")}</span>
        </div>
        ` : ""}
        <div class="info-row">
          <span class="info-label">الحالة:</span>
          <span class="info-value">${poRequest.status === "pending" ? "في انتظار عرض السعر" : poRequest.status}</span>
        </div>
      </div>
      
      <div class="info-box">
        <h3>بيانات المورد / Supplier Details</h3>
        <div class="info-row">
          <span class="info-label">اسم المورد:</span>
          <span class="info-value">${supplier.supplier_name || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">التليفون:</span>
          <span class="info-value">${supplier.phone || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">البريد الإلكتروني:</span>
          <span class="info-value">${supplier.email || "-"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">العنوان:</span>
          <span class="info-value">${supplier.address || "-"}</span>
        </div>
      </div>
    </div>
    
    <!-- Items Table (No Prices) -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50px;">م</th>
          <th>اسم الصنف / Item Description</th>
          <th style="width: 100px;">الكود / SKU</th>
          <th style="width: 100px;">الكمية / Quantity</th>
          <th style="width: 80px;">الوحدة / Unit</th>
          <th>ملاحظات / Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item: any, index: number) => `
          <tr>
            <td>${index + 1}</td>
            <td style="text-align: right;">${item.products?.product_name || item.product_name || "-"}</td>
            <td>${item.products?.sku || "-"}</td>
            <td>${item.quantity}</td>
            <td>${item.unit || item.products?.unit || "-"}</td>
            <td style="text-align: right;">${item.notes || "-"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    
    <!-- Quotation Request Note -->
    <div class="quotation-request-note">
      <h4>مطلوب من المورد / Required from Supplier:</h4>
      <p>يرجى تزويدنا بعرض سعر للأصناف المذكورة أعلاه يتضمن:</p>
      <p>Please provide us with a quotation for the above items including:</p>
      <ul style="text-align: right; margin: 15px auto; max-width: 400px;">
        <li>سعر الوحدة لكل صنف / Unit price for each item</li>
        <li>مدة الصلاحية / Validity period</li>
        <li>شروط الدفع / Payment terms</li>
        <li>مدة التسليم / Delivery time</li>
      </ul>
    </div>
    
    ${poRequest.notes ? `
    <div class="notes-section">
      <h4>ملاحظات إضافية / Additional Notes:</h4>
      <p>${poRequest.notes}</p>
    </div>
    ` : ""}
    
    <!-- Signature Section -->
    <div class="signature-section">
      <div class="signature-box">
        <div class="signature-line">مدير المشتريات / Procurement Manager</div>
      </div>
      <div class="signature-box">
        <div class="signature-line">ختم المورد / Supplier Stamp</div>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="footer">
      <p>شركة مصر للمحركات - ${COMPANY_SETTINGS.address}</p>
      <p>هاتف: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax} | ${COMPANY_SETTINGS.email}</p>
    </div>
  </div>
</body>
</html>
`

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    console.error("PO Request PDF error:", error)
    return new NextResponse(generateErrorHTML("Internal server error"), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
}

function generateErrorHTML(message: string, details?: string): string {
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>خطأ</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #fef2f2;
    }
    .error-box {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 500px;
    }
    h1 { color: #dc2626; margin-bottom: 15px; }
    p { color: #666; margin: 10px 0; }
    .details { font-size: 12px; color: #999; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>⚠️ خطأ</h1>
    <p>${message}</p>
    ${details ? `<p class="details">${details}</p>` : ""}
  </div>
</body>
</html>
`
}
