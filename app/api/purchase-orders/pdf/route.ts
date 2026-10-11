import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle } from "@/lib/print/print-theme"

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
    ${PRINT_CSS}
    .container { max-width: 800px; margin: 0 auto; }
    .print-btn { position: fixed; top: 15px; left: 15px; padding: 12px 24px; background: #1a56db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .print-btn:hover { background: #1e40af; }
    @media screen { body { padding: 20px; } }
    @media print { .print-btn { display: none !important; } }
    .pm-info { margin-block: 10px; }
    .status-badge { display: inline-block; }
    .pm-note h4 { margin-block-end: 4px; font-size: 13px; font-weight: 700; }
    .pm-note p { margin-block: 2px; }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ طباعة / Print</button>
  
  <div class="container">
    ${printHeader({
      logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="logo" />` : `<div class="company-name-ar">مصر موتورز</div>`}`,
      company: {
        nameAr: `${COMPANY_SETTINGS.nameAr}`,
        nameEn: `${COMPANY_SETTINGS.nameEn}`,
        detailsHtml: `
        العنوان: ${COMPANY_SETTINGS.address}<br>
        تليفون: ${COMPANY_SETTINGS.phone} | فاكس: ${COMPANY_SETTINGS.fax}<br>
        البريد الإلكتروني: ${COMPANY_SETTINGS.email}
      `,
      },
      taxInfo: `${getTaxInfo()}`,
    })}
    
    ${docTitle({ titleAr: `${po.status === "pending" ? "طلب عرض أسعار / Quotation Request" : "أمر شراء / Purchase Order"}` })}
    
    <section class="pm-info">
        <div class="pm-info-title">بيانات أمر الشراء / PO Details</div>
        <div class="pm-fields">
        <div class="pm-field">
          <div class="pm-label">رقم أمر الشراء:</div>
          <div class="pm-value">${escapeHtml(po.po_number)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">التاريخ:</div>
          <div class="pm-value">${formatDate(po.order_date || po.created_at)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">تاريخ التسليم المتوقع:</div>
          <div class="pm-value">${formatDate(po.delivery_date)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">الحالة:</div>
          <div class="pm-value">
            <span class="status-badge status-${escapeHtml(po.status)}">${
              po.status === "pending" ? "معلق" :
              po.status === "approved" ? "معتمد" :
              po.status === "rejected" ? "مرفوض" :
              po.status === "received" ? "مستلم" :
              po.status === "partially_received" ? "مستلم جزئياً" :
              po.status === "received_with_issues" ? "مستلم مع ملاحظات" : escapeHtml(po.status)
            }</span>
          </div>
        </div>
        ${po.status !== "pending" ? `
        <div class="pm-field">
          <div class="pm-label">نوع الدفع:</div>
          <div class="pm-value">${escapeHtml(getPaymentTermsDisplay())}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">العملة:</div>
          <div class="pm-value">${escapeHtml(po.currency || "EGP")}</div>
        </div>
        ` : ""}
        </div>
    </section>
      
    <section class="pm-info">
        <div class="pm-info-title">بيانات المورد / Supplier Details</div>
        <div class="pm-fields">
        <div class="pm-field">
          <div class="pm-label">اسم المورد:</div>
          <div class="pm-value">${escapeHtml(supplier.supplier_name || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">الهاتف:</div>
          <div class="pm-value">${escapeHtml(supplier.phone || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">البريد الإلكتروني:</div>
          <div class="pm-value">${escapeHtml(supplier.email || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">العنوان:</div>
          <div class="pm-value">${escapeHtml(supplier.address || "-")}${supplier.city ? `, ${escapeHtml(supplier.city)}` : ""}${supplier.country ? `, ${escapeHtml(supplier.country)}` : ""}</div>
        </div>
        </div>
    </section>
    
    <table class="pm-table">
      <thead>
        <tr>
          <th class="pm-center" style="width: 50px;">م</th>
          <th>اسم الصنف / Item</th>
          <th class="pm-center" style="width: 80px;">الكود / SKU</th>
          <th class="pm-center" style="width: 100px;">الكمية / Qty</th>
          ${po.status !== "pending" ? `
          <th class="pm-num" style="width: 100px;">سعر الوحدة / Unit Price</th>
          <th class="pm-num" style="width: 120px;">الإجمالي / Total</th>
          ` : ""}
        </tr>
      </thead>
      <tbody>
        ${poItems.map((item, index) => `
          <tr>
            <td class="pm-center">${index + 1}</td>
            <td>${escapeHtml(item.products?.product_name || item.item_name_snapshot || item.product_name || "Unknown")}</td>
            <td class="pm-center">${escapeHtml(item.products?.sku || "-")}</td>
            <td class="pm-center">${escapeHtml(item.quantity)} ${escapeHtml(item.products?.unit || "")}</td>
            ${po.status !== "pending" ? `
            <td class="pm-num">${(item.unit_price || 0).toFixed(2)}</td>
            <td class="pm-num">${(item.total_price || item.quantity * item.unit_price || 0).toFixed(2)}</td>
            ` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
    
    ${po.status !== "pending" ? `
      <table class="pm-totals">
        <tr>
          <td>المجموع الفرعي / Subtotal:</td>
          <td class="pm-num">${subtotal.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ${taxAmount > 0 ? `
        <tr>
          <td>الضرائب / Tax:</td>
          <td class="pm-num">${taxAmount.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        ${otherCosts > 0 ? `
        <tr>
          <td>تكاليف أخرى / Other Costs:</td>
          <td class="pm-num">${otherCosts.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        <tr class="pm-total-final">
          <td>الإجمالي الكلي / Grand Total:</td>
          <td class="pm-num">${total.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
      </table>
    ` : `
    <div class="pm-note">
      <h4>ملاحظة هامة / Important Note:</h4>
      <p>هذا طلب عرض أسعار. يرجى إرسال عرض السعر الخاص بكم للأصناف المذكورة أعلاه.</p>
      <p>This is a quotation request. Please send your price quote for the items listed above.</p>
    </div>
    `}
    
    ${po.notes ? `
    <div class="pm-note">
      <h4>ملاحظات / Notes:</h4>
      <p>${escapeHtml(po.notes)}</p>
    </div>
    ` : ""}
    
    <div class="pm-signatures">
      <div class="pm-sign">
        <div>توقيع المشتري / Buyer Signature</div><div class="pm-sign-line"></div>
      </div>
      <div class="pm-sign">
        <div>توقيع المورد / Supplier Signature</div><div class="pm-sign-line"></div>
      </div>
      <div class="pm-sign">
        <div>الاعتماد / Approval</div><div class="pm-sign-line"></div>
      </div>
    </div>
    
    <div class="pm-footer">
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
