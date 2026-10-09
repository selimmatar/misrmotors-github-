import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle, infoBox } from "@/lib/print/print-theme"

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
  <title>طلب عرض أسعار - ${escapeHtml(poRequest.request_number)}</title>
  <style>
    ${PRINT_CSS}
    .container { max-width: 800px; margin: 0 auto; }
    .print-button { position: fixed; top: 20px; inset-inline-start: 20px; padding: 12px 24px; background: #fff; color: #000; border: 1px solid #000; cursor: pointer; font-size: 16px; font-weight: 600; z-index: 1000; }
    @media screen { body { padding: 20px; } }
    @media print { .print-button { display: none !important; } }
    .pm-note h4 { margin-block-end: 4px; font-size: 13px; font-weight: 700; }
    .pm-note p { margin-block: 2px; }
    .pm-note ul { padding-inline-start: 18px; }
  </style>
</head>
<body>
  <button class="print-button" onclick="window.print()">طباعة 🖨️</button>
  
  <div class="container">
    <!-- Company Header -->
    ${printHeader({
      logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="company-logo" />` : `<div style="font-size: 28px; font-weight: bold; color: #1a56db; margin-bottom: 10px;">مصر موتورز</div>`}`,
      company: {
        nameAr: `${COMPANY_SETTINGS.nameAr}`,
        nameEn: `${COMPANY_SETTINGS.nameEn}`,
        detailsHtml: `
        <div>العنوان: ${COMPANY_SETTINGS.address}</div>
        <div>تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}</div>
        <div>البريد الإلكتروني: ${COMPANY_SETTINGS.email}</div>
      `,
      },
      taxInfo: `${getTaxInfo()}`,
    })}
    
    <!-- Document Title -->
    ${docTitle({ titleAr: `طلب عرض أسعار / Quotation Request` })}
    
    <!-- Info Section -->
    <section class="pm-info">
        <div class="pm-info-title">بيانات الطلب / Request Details</div>
        <div class="pm-fields">
        <div class="pm-field">
          <div class="pm-label">رقم الطلب:</div>
          <div class="pm-value">${escapeHtml(poRequest.request_number)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">تاريخ الطلب:</div>
          <div class="pm-value">${new Date(poRequest.request_date || poRequest.created_at).toLocaleDateString("ar-EG")}</div>
        </div>
        ${poRequest.expected_delivery_date ? `
        <div class="pm-field">
          <div class="pm-label">تاريخ التسليم المتوقع:</div>
          <div class="pm-value">${new Date(poRequest.expected_delivery_date).toLocaleDateString("ar-EG")}</div>
        </div>
        ` : ""}
        <div class="pm-field">
          <div class="pm-label">الحالة:</div>
          <div class="pm-value">${escapeHtml(poRequest.status === "pending" ? "في انتظار عرض السعر" : poRequest.status)}</div>
        </div>
        </div>
    </section>
      
    ${infoBox(`بيانات المورد / Supplier Details`, [
      [`اسم المورد:`, `${escapeHtml(supplier.supplier_name || "-")}`],
      [`التليفون:`, `${escapeHtml(supplier.phone || "-")}`],
      [`البريد الإلكتروني:`, `${escapeHtml(supplier.email || "-")}`],
      [`العنوان:`, `${escapeHtml(supplier.address || "-")}`],
    ])}
    
    <!-- Items Table (No Prices) -->
    <table class="pm-table">
      <thead>
        <tr>
          <th class="pm-center" style="width: 50px;">م</th>
          <th>اسم الصنف / Item Description</th>
          <th class="pm-center" style="width: 100px;">الكود / SKU</th>
          <th class="pm-center" style="width: 100px;">الكمية / Quantity</th>
          <th class="pm-center" style="width: 80px;">الوحدة / Unit</th>
          <th>ملاحظات / Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item: any, index: number) => `
          <tr>
            <td class="pm-center">${index + 1}</td>
            <td>${escapeHtml(item.products?.product_name || item.product_name || "-")}</td>
            <td class="pm-center">${escapeHtml(item.products?.sku || "-")}</td>
            <td class="pm-center">${escapeHtml(item.quantity)}</td>
            <td class="pm-center">${escapeHtml(item.unit || item.products?.unit || "-")}</td>
            <td>${escapeHtml(item.notes || "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    
    <!-- Quotation Request Note -->
    <div class="quotation-request-note pm-note">
      <h4>مطلوب من المورد / Required from Supplier:</h4>
      <p>يرجى تزويدنا بعرض سعر للأصناف المذكورة أعلاه يتضمن:</p>
      <p>Please provide us with a quotation for the above items including:</p>
      <ul>
        <li>سعر الوحدة لكل صنف / Unit price for each item</li>
        <li>مدة الصلاحية / Validity period</li>
        <li>شروط الدفع / Payment terms</li>
        <li>مدة التسليم / Delivery time</li>
      </ul>
    </div>
    
    ${poRequest.notes ? `
    <div class="pm-note">
      <h4>ملاحظات إضافية / Additional Notes:</h4>
      <p>${escapeHtml(poRequest.notes)}</p>
    </div>
    ` : ""}
    
    <!-- Signature Section -->
    <div class="pm-signatures">
      <div class="pm-sign">
        <div>مدير المشتريات / Procurement Manager</div><div class="pm-sign-line"></div>
      </div>
      <div class="pm-sign">
        <div>ختم المورد / Supplier Stamp</div><div class="pm-sign-line"></div>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="pm-footer">
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
    <p>${escapeHtml(message)}</p>
    ${details ? `<p class="details">${escapeHtml(details)}</p>` : ""}
  </div>
</body>
</html>
`
}
