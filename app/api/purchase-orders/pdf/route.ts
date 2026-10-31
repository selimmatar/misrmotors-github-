import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { chainTextForPrint } from "@/lib/po-requests/chain"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle, PRINT_ROWS_SCRIPT } from "@/lib/print/print-theme"

export const dynamic = "force-dynamic"

// The PO is printed in Arabic (default) or in English (?lang=en), chosen when printing.
const TEXT = {
  ar: {
    dir: "rtl",
    lang: "ar",
    title: "أمر شراء",
    print: "🖨️ طباعة",
    logoName: "مصر موتورز",
    address: "العنوان",
    phone: "تليفون",
    fax: "فاكس",
    email: "البريد الإلكتروني",
    poInfo: "بيانات أمر الشراء",
    poNumber: "رقم أمر الشراء:",
    linkedTo: "مرتبط بـ:",
    date: "التاريخ:",
    delivery: "تاريخ التسليم المتوقع:",
    status: "الحالة:",
    payment: "نوع الدفع:",
    currency: "العملة:",
    supplierInfo: "بيانات المورد",
    supplierName: "اسم المورد:",
    supplierPhone: "الهاتف:",
    supplierEmail: "البريد الإلكتروني:",
    supplierAddress: "العنوان:",
    colNo: "م",
    colItem: "اسم الصنف",
    colCode: "الكود",
    colQty: "الكمية",
    colCost: "تكلفة الوحدة",
    colTotal: "الإجمالي",
    subtotal: "المجموع الفرعي:",
    tax: "الضرائب:",
    other: "تكاليف أخرى:",
    total: "الإجمالي الكلي:",
    notes: "ملاحظات:",
    signBuyer: "توقيع المشتري",
    signSupplier: "توقيع المورد",
    signApproval: "الاعتماد",
    statuses: { pending: "معلق", approved: "معتمد", rejected: "مرفوض", received: "مستلم", partially_received: "مستلم جزئياً", received_with_issues: "مستلم مع ملاحظات" } as Record<string, string>,
    terms: { cash: "نقدي", prepaid: "مدفوع مقدماً", cheque: "شيك", installments: "أقساط", months: "شهور", hybrid: "مقدم + أقساط" },
  },
  en: {
    dir: "ltr",
    lang: "en",
    title: "Purchase Order",
    print: "🖨️ Print",
    logoName: "Misr Motors",
    address: "Address",
    phone: "Tel",
    fax: "Fax",
    email: "Email",
    poInfo: "Purchase order details",
    poNumber: "PO number:",
    linkedTo: "Linked to:",
    date: "Date:",
    delivery: "Expected delivery:",
    status: "Status:",
    payment: "Payment terms:",
    currency: "Currency:",
    supplierInfo: "Supplier details",
    supplierName: "Supplier:",
    supplierPhone: "Phone:",
    supplierEmail: "Email:",
    supplierAddress: "Address:",
    colNo: "#",
    colItem: "Item",
    colCode: "Code",
    colQty: "Quantity",
    colCost: "Unit cost",
    colTotal: "Total",
    subtotal: "Subtotal:",
    tax: "Taxes:",
    other: "Other costs:",
    total: "Grand total:",
    notes: "Notes:",
    signBuyer: "Buyer signature",
    signSupplier: "Supplier signature",
    signApproval: "Approval",
    statuses: { pending: "Pending", approved: "Approved", rejected: "Rejected", received: "Received", partially_received: "Partially received", received_with_issues: "Received with issues" } as Record<string, string>,
    terms: { cash: "Cash", prepaid: "Prepaid", cheque: "Cheque", installments: "Installments", months: "months", hybrid: "Down payment + installments" },
  },
}
const ADDRESS_EN = "212 Sudan St., Lebanon Square, Mohandessin, Giza"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const poId = searchParams.get("poId")
    const english = searchParams.get("lang") === "en"
    const L = english ? TEXT.en : TEXT.ar

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
    const subtotal = poItems.reduce((sum, item) => sum + Number(item.total_price || item.quantity * item.unit_price || 0), 0)
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
        case "cash": return L.terms.cash
        case "prepaid": return L.terms.prepaid
        case "installments":
        case "installment": return `${L.terms.installments} (${po.installments || po.remaining_installment_months || 6} ${L.terms.months})`
        case "hybrid": return `${L.terms.hybrid} (${po.down_payment_percent || 0}% + ${po.remaining_installment_months || 6} ${L.terms.months})`
        case "cheque": return L.terms.cheque
        default: return paymentType
      }
    }

    const chainLine = await chainTextForPrint(supabase, { poId: po.po_id })
    const html = `<!DOCTYPE html>
<html dir="${L.dir}" lang="${L.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L.title} - ${escapeHtml(po.po_number)}</title>
  <style>
    ${PRINT_CSS}
    .container { max-width: 800px; margin: 0 auto; }
    .print-btn { position: fixed; top: 15px; ${english ? "right" : "left"}: 15px; padding: 12px 24px; background: #1a56db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
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
  <button class="print-btn" onclick="window.print()">${L.print}</button>
  
  <div class="container">
    ${printHeader({
      logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="logo" />` : `<div class="company-name-ar">${L.logoName}</div>`}`,
      company: {
        nameAr: `${COMPANY_SETTINGS.nameAr}`,
        nameEn: `${COMPANY_SETTINGS.nameEn}`,
        detailsHtml: `
        ${L.address}: ${english ? ADDRESS_EN : COMPANY_SETTINGS.address}<br>
        ${L.phone}: ${COMPANY_SETTINGS.phone} | ${L.fax}: ${COMPANY_SETTINGS.fax}<br>
        ${L.email}: ${COMPANY_SETTINGS.email}
      `,
      },
      taxInfo: english
        ? `Tax card no.: ${COMPANY_SETTINGS.taxCard} | Tax file: ${COMPANY_SETTINGS.taxFile} | Registration no.: ${COMPANY_SETTINGS.registrationNo}`
        : `${getTaxInfo()}`,
    })}
    
    ${docTitle({ titleAr: L.title })}
    
    <section class="pm-info">
        <div class="pm-info-title">${L.poInfo}</div>
        <div class="pm-fields">
        <div class="pm-field">
          <div class="pm-label">${L.poNumber}</div>
          <div class="pm-value">${escapeHtml(po.po_number)}</div>
        </div>${chainLine ? `
        <div class="pm-field">
          <div class="pm-label">${L.linkedTo}</div>
          <div class="pm-value" dir="ltr">${escapeHtml(chainLine)}</div>
        </div>` : ""}
        <div class="pm-field">
          <div class="pm-label">${L.date}</div>
          <div class="pm-value">${formatDate(po.order_date || po.created_at)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.delivery}</div>
          <div class="pm-value">${formatDate(po.delivery_date)}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.status}</div>
          <div class="pm-value">
            <span class="status-badge status-${escapeHtml(po.status)}">${L.statuses[po.status] || escapeHtml(po.status)}</span>
          </div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.payment}</div>
          <div class="pm-value">${escapeHtml(getPaymentTermsDisplay())}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.currency}</div>
          <div class="pm-value">${escapeHtml(po.currency || "EGP")}</div>
        </div>
        </div>
    </section>
      
    <section class="pm-info">
        <div class="pm-info-title">${L.supplierInfo}</div>
        <div class="pm-fields">
        <div class="pm-field">
          <div class="pm-label">${L.supplierName}</div>
          <div class="pm-value">${escapeHtml(supplier.supplier_name || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.supplierPhone}</div>
          <div class="pm-value">${escapeHtml(supplier.phone || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.supplierEmail}</div>
          <div class="pm-value">${escapeHtml(supplier.email || "-")}</div>
        </div>
        <div class="pm-field">
          <div class="pm-label">${L.supplierAddress}</div>
          <div class="pm-value">${escapeHtml(supplier.address || "-")}${supplier.city ? `, ${escapeHtml(supplier.city)}` : ""}${supplier.country ? `, ${escapeHtml(supplier.country)}` : ""}</div>
        </div>
        </div>
    </section>
    
    <table class="pm-table">
      <thead>
        <tr>
          <th class="pm-center" style="width: 50px;">${L.colNo}</th>
          <th>${L.colItem}</th>
          <th class="pm-center" style="width: 80px;">${L.colCode}</th>
          <th class="pm-center" style="width: 100px;">${L.colQty}</th>
          <th class="pm-num" style="width: 100px;">${L.colCost}</th>
          <th class="pm-num" style="width: 120px;">${L.colTotal}</th>
        </tr>
      </thead>
      <tbody>
        ${poItems.map((item, index) => `
          <tr>
            <td class="pm-center">${index + 1}</td>
            <td>${escapeHtml(item.products?.product_name || item.item_name_snapshot || item.product_name || "Unknown")}</td>
            <td class="pm-center">${escapeHtml(item.products?.sku || "-")}</td>
            <td class="pm-center">${escapeHtml(item.quantity)} ${escapeHtml(item.products?.unit || "")}</td>
            <td class="pm-num">${Number(item.unit_price) ? Number(item.unit_price).toFixed(2) : "-"}</td>
            <td class="pm-num">${Number(item.total_price || item.quantity * item.unit_price || 0).toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    
      <table class="pm-totals">
        <tr>
          <td>${L.subtotal}</td>
          <td class="pm-num">${subtotal.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ${taxAmount > 0 ? `
        <tr>
          <td>${L.tax}</td>
          <td class="pm-num">${taxAmount.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        ${otherCosts > 0 ? `
        <tr>
          <td>${L.other}</td>
          <td class="pm-num">${otherCosts.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
        ` : ""}
        <tr class="pm-total-final">
          <td>${L.total}</td>
          <td class="pm-num">${total.toFixed(2)} ${escapeHtml(po.currency || "EGP")}</td>
        </tr>
      </table>
    
    ${po.notes ? `
    <div class="pm-note">
      <h4>${L.notes}</h4>
      <p>${escapeHtml(po.notes)}</p>
    </div>
    ` : ""}
    
    <div class="pm-signatures">
      <div class="pm-sign">
        <div>${L.signBuyer}</div><div class="pm-sign-line"></div>
      </div>
      <div class="pm-sign">
        <div>${L.signSupplier}</div><div class="pm-sign-line"></div>
      </div>
      <div class="pm-sign">
        <div>${L.signApproval}</div><div class="pm-sign-line"></div>
      </div>
    </div>
    
    <div class="pm-footer">
      ${english ? "" : "<p>هذا أمر شراء رسمي صادر من شركة مصر للمحركات</p>\n      "}<p>This is an official purchase order issued by Misr Motors Co.</p>
      <p>${english ? "" : `تاريخ الطباعة: ${new Date().toLocaleDateString("ar-EG")} | `}Printed: ${new Date().toLocaleDateString("en-GB")}</p>
    </div>
  </div>
${PRINT_ROWS_SCRIPT}
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
