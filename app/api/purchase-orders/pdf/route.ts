import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const poId = searchParams.get("poId")

    if (!poId) {
      return new NextResponse(
        `<!DOCTYPE html><html><body style="font-family: Arial; padding: 40px; text-align: center;">
          <h2 style="color: #dc2626;">Missing PO ID</h2>
          <p>Please provide a valid purchase order ID</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    }

    const supabase = createAdminClient()

    // Fetch purchase order with supplier info
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
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
        )
      `)
      .eq("po_id", Number.parseInt(poId))
      .single()

    if (poError || !po) {
      console.error("PO PDF - Error fetching PO:", poError)
      return new NextResponse(
        `<!DOCTYPE html><html><body style="font-family: Arial; padding: 40px; text-align: center;">
          <h2 style="color: #dc2626;">Purchase Order Not Found</h2>
          <p>PO ID: ${escapeHtml(poId)}</p>
          <p>Error: ${escapeHtml(poError?.message || "Not found")}</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    }

    // Fetch PO items with product details
    const { data: items, error: itemsError } = await supabase
      .from("purchase_order_items")
      .select(`
        *,
        products:product_id (
          product_name,
          sku,
          unit
        )
      `)
      .eq("po_id", Number.parseInt(poId))

    if (itemsError) {
      console.error("PO PDF - Error fetching items:", itemsError)
    }

    const poItems = items || []
    const supplier = po.suppliers || {}

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

    // Calculate totals
    const subtotal = poItems.reduce((sum, item) => sum + (item.total_price || item.quantity * item.unit_price || 0), 0)
    const taxAmount = po.tax_amount || 0
    const otherCosts = po.other_costs || 0
    const total = po.total || subtotal + taxAmount + otherCosts

    // Format dates
    const formatDate = (dateStr: string) => {
      if (!dateStr) return "-"
      const date = new Date(dateStr)
      return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    }

    // Get payment terms display
    const getPaymentTermsDisplay = () => {
      const paymentType = po.payment_type || po.payment_terms || "cash"
      switch (paymentType) {
        case "cash": return "نقدي / Cash"
        case "prepaid": return "مدفوع مقدماً / Prepaid"
        case "installments":
        case "installment": return `أقساط (${po.installments || po.remaining_installment_months || 6} شهور) / Installments`
        case "hybrid": return `مقدم + أقساط / Hybrid (${po.down_payment_percent || 0}% + ${po.remaining_installment_months || 6} months)`
        case "cheque": return "شيك / Cheque"
        default: return paymentType
      }
    }

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>أمر شراء - ${escapeHtml(po.po_number)}</title>
  <style>
    @media print { 
      body { margin: 0; } 
      .print-btn { display: none !important; }
    }
    * { box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      direction: rtl; 
      margin: 0;
      padding: 20px;
      background: white;
      color: #333;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header { 
      text-align: center; 
      margin-bottom: 30px; 
      border-bottom: 3px solid #1a56db; 
      padding-bottom: 20px; 
    }
    .logo { max-height: 80px; margin-bottom: 10px; }
    .company-name-ar { font-size: 24px; font-weight: bold; color: #1a56db; margin: 5px 0; }
    .company-name-en { font-size: 18px; font-weight: bold; color: #333; margin: 5px 0; }
    .company-details { font-size: 12px; line-height: 1.8; color: #555; margin-top: 10px; }
    .tax-info { font-size: 11px; color: #666; margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 8px; }
    
    .document-title {
      text-align: center;
      margin: 25px 0;
      padding: 15px;
      background: linear-gradient(135deg, #1a56db 0%, #3b82f6 100%);
      color: white;
      font-size: 22px;
      font-weight: bold;
      border-radius: 8px;
    }
    
    .info-section {
      display: flex;
      gap: 20px;
      margin-bottom: 25px;
    }
    .info-box {
      flex: 1;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      background: #f9fafb;
    }
    .info-box h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #1a56db;
      border-bottom: 2px solid #1a56db;
      padding-bottom: 8px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin: 8px 0;
      font-size: 13px;
    }
    .info-label { color: #666; }
    .info-value { font-weight: 600; color: #333; }
    
    .items-table { 
      width: 100%; 
      border-collapse: collapse; 
      margin: 20px 0;
      font-size: 13px;
    }
    .items-table th { 
      background: #1a56db; 
      color: white;
      padding: 12px 10px; 
      text-align: center;
      font-weight: 600;
    }
    .items-table td { 
      border: 1px solid #ddd; 
      padding: 10px; 
      text-align: center;
    }
    .items-table tbody tr:nth-child(even) { background: #f9fafb; }
    .items-table tbody tr:hover { background: #f0f9ff; }
    
    .totals-section {
      margin-top: 25px;
      display: flex;
      justify-content: flex-end;
    }
    .totals-table {
      width: 300px;
      border-collapse: collapse;
    }
    .totals-table td {
      padding: 10px 15px;
      border: 1px solid #ddd;
    }
    .totals-table tr:last-child {
      background: #1a56db;
      color: white;
      font-weight: bold;
      font-size: 15px;
    }
    
    .notes-section {
      margin-top: 25px;
      padding: 15px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: #fffbeb;
    }
    .notes-section h4 {
      margin: 0 0 10px 0;
      color: #92400e;
    }
    
    .signature-section {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
    }
    .signature-box {
      width: 200px;
      text-align: center;
    }
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 60px;
      padding-top: 8px;
      font-size: 12px;
    }
    
    .footer {
      margin-top: 40px;
      text-align: center;
      font-size: 11px;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 15px;
    }
    
    .print-btn { 
      position: fixed; 
      top: 15px; 
      left: 15px; 
      padding: 12px 24px; 
      background: #1a56db; 
      color: white; 
      border: none; 
      border-radius: 6px; 
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .print-btn:hover { background: #1e40af; }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-approved { background: #d1fae5; color: #065f46; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-received { background: #dbeafe; color: #1e40af; }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ طباعة / Print</button>
  
  <div class="container">
    <div class="header">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="logo" />` : `<div class="company-name-ar">مصر موتورز</div>`}
      <div class="company-name-ar">${COMPANY_SETTINGS.nameAr}</div>
      <div class="company-name-en">${COMPANY_SETTINGS.nameEn}</div>
      <div class="company-details">
        العنوان: ${COMPANY_SETTINGS.address}<br>
        تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}<br>
        البريد الإلكتروني: ${COMPANY_SETTINGS.email}
      </div>
      <div class="tax-info">${getTaxInfo()}</div>
    </div>
    
    <div class="document-title">
      ${po.status === "pending" ? "طلب عرض أسعار / Quotation Request" : "أمر شراء / Purchase Order"}
    </div>
    
    <div class="info-section">
      <div class="info-box">
        <h3>بيانات أمر الشراء / PO Details</h3>
        <div class="info-row">
          <span class="info-label">رقم أمر الشراء:</span>
          <span class="info-value">${escapeHtml(po.po_number)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">التاريخ:</span>
          <span class="info-value">${formatDate(po.order_date || po.created_at)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">تاريخ التسليم المتوقع:</span>
          <span class="info-value">${formatDate(po.delivery_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">الحالة:</span>
          <span class="info-value">
            <span class="status-badge status-${escapeHtml(po.status)}">${
              po.status === "pending" ? "معلق" :
              po.status === "approved" ? "معتمد" :
              po.status === "rejected" ? "مرفوض" :
              po.status === "received" ? "مستلم" : escapeHtml(po.status)
            }</span>
          </span>
        </div>
        ${po.status !== "pending" ? `
        <div class="info-row">
          <span class="info-label">نوع الدفع:</span>
          <span class="info-value">${escapeHtml(getPaymentTermsDisplay())}</span>
        </div>
        <div class="info-row">
          <span class="info-label">العملة:</span>
          <span class="info-value">${escapeHtml(po.currency || "EGP")}</span>
        </div>
        ` : ""}
      </div>
      
      <div class="info-box">
        <h3>بيانات المورد / Supplier Details</h3>
        <div class="info-row">
          <span class="info-label">اسم المورد:</span>
          <span class="info-value">${escapeHtml(supplier.supplier_name || "-")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">الهاتف:</span>
          <span class="info-value">${escapeHtml(supplier.phone || "-")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">البريد الإلكتروني:</span>
          <span class="info-value">${escapeHtml(supplier.email || "-")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">العنوان:</span>
          <span class="info-value">${escapeHtml(supplier.address || "-")}${supplier.city ? `, ${escapeHtml(supplier.city)}` : ""}${supplier.country ? `, ${escapeHtml(supplier.country)}` : ""}</span>
        </div>
      </div>
    </div>
    
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50px;">م</th>
          <th>اسم الصنف / Item</th>
          <th style="width: 80px;">الكود / SKU</th>
          <th style="width: 100px;">الكمية / Qty</th>
          ${po.status !== "pending" ? `
          <th style="width: 100px;">سعر الوحدة / Unit Price</th>
          <th style="width: 120px;">الإجمالي / Total</th>
          ` : ""}
        </tr>
      </thead>
      <tbody>
        ${poItems.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td style="text-align: right;">${escapeHtml(item.products?.product_name || item.item_name_snapshot || item.product_name || "Unknown")}</td>
            <td>${escapeHtml(item.products?.sku || "-")}</td>
            <td>${escapeHtml(item.quantity)} ${escapeHtml(item.products?.unit || "")}</td>
            ${po.status !== "pending" ? `
            <td>${(item.unit_price || 0).toFixed(2)}</td>
            <td>${(item.total_price || item.quantity * item.unit_price || 0).toFixed(2)}</td>
            ` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
    
    ${po.status !== "pending" ? `
    <div class="totals-section">
      <table class="totals-table">
        <tr>
          <td>المجموع الفرعي / Subtotal:</td>
          <td style="text-align: left;">${subtotal.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ${taxAmount > 0 ? `
        <tr>
          <td>الضرائب / Tax:</td>
          <td style="text-align: left;">${taxAmount.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        ${otherCosts > 0 ? `
        <tr>
          <td>تكاليف أخرى / Other Costs:</td>
          <td style="text-align: left;">${otherCosts.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        <tr>
          <td>الإجمالي الكلي / Grand Total:</td>
          <td style="text-align: left;">${total.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
      </table>
    </div>
    ` : `
    <div class="notes-section" style="background: #f0f9ff; border-color: #3b82f6;">
      <h4 style="color: #1e40af;">ملاحظة هامة / Important Note:</h4>
      <p>هذا طلب عرض أسعار. يرجى إرسال عرض السعر الخاص بكم للأصناف المذكورة أعلاه.</p>
      <p>This is a quotation request. Please send your price quote for the items listed above.</p>
    </div>
    `}
    
    ${po.notes ? `
    <div class="notes-section">
      <h4>ملاحظات / Notes:</h4>
      <p>${escapeHtml(po.notes)}</p>
    </div>
    ` : ""}
    
    <div class="signature-section">
      <div class="signature-box">
        <div class="signature-line">توقيع المشتري / Buyer Signature</div>
      </div>
      <div class="signature-box">
        <div class="signature-line">توقيع المورد / Supplier Signature</div>
      </div>
      <div class="signature-box">
        <div class="signature-line">الاعتماد / Approval</div>
      </div>
    </div>
    
    <div class="footer">
      <p>هذا أمر شراء رسمي صادر من شركة مصر للمحركات</p>
      <p>This is an official purchase order issued by Misr Motors Co.</p>
      <p>تاريخ الطباعة: ${new Date().toLocaleDateString("ar-EG")} | Printed: ${new Date().toLocaleDateString("en-GB")}</p>
    </div>
  </div>
</body>
</html>`

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="PO-${String(po.po_number).replace(/[^A-Za-z0-9._-]/g, "_")}.html"`,
      },
    })
  } catch (error: any) {
    console.error("PO PDF error:", error)
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family: Arial; padding: 40px; text-align: center;">
        <h2 style="color: #dc2626;">Error Generating PO PDF</h2>
        <p>${escapeHtml(error.message)}</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }
}
