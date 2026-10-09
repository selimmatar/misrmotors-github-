import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle } from "@/lib/print/print-theme"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminClient = createAdminClient()
    const { id: workOrderId } = await params

    // Fetch work order with related data
    const { data: workOrder, error } = await adminClient
      .from("maintenance_work_orders")
      .select(`
        *,
        sales_orders!maintenance_work_orders_sales_order_id_fkey (
          so_number
        ),
        customers (
          customer_name,
          address,
          phone
        )
      `)
      .eq("work_order_id", workOrderId)
      .single()

    if (error || !workOrder) {
      return NextResponse.json({ error: "Work order not found" }, { status: 404 })
    }

    const salesOrder = Array.isArray(workOrder.sales_orders) ? workOrder.sales_orders[0] : workOrder.sales_orders
    const customer = Array.isArray(workOrder.customers) ? workOrder.customers[0] : workOrder.customers

    // Fetch assigned employee name
    let assignedEmployeeName = ""
    if (workOrder.assigned_to) {
      const { data: emp } = await adminClient
        .from("hr_employees")
        .select("full_name")
        .eq("employee_id", workOrder.assigned_to)
        .single()
      assignedEmployeeName = emp?.full_name || ""
    }

    const statusAr = workOrder.status === "pending" ? "\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631" : workOrder.status === "in_progress" ? "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630" : workOrder.status === "completed" ? "\u0645\u0643\u062A\u0645\u0644" : workOrder.status
    const categoryAr = workOrder.category === "repair" ? "\u0625\u0635\u0644\u0627\u062D" : workOrder.category === "inspection" ? "\u0641\u062D\u0635" : workOrder.category === "installation" ? "\u062A\u0631\u0643\u064A\u0628" : workOrder.category === "preventive" ? "\u0635\u064A\u0627\u0646\u0629 \u0648\u0642\u0627\u0626\u064A\u0629" : workOrder.category || "\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631"
    const na = "\u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631"
    const dateStr = new Date(workOrder.created_at).toLocaleDateString("ar-EG")

    const emptyRows = Array(10).fill("<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>").join("\n        ")

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

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
${PRINT_CSS}
.section{margin-bottom:12px}
.section .pm-fields{border-block-start:0;padding-block-start:0}
.pm-table td{height:30px}
.notes-section{min-height:180px;border-block:1px solid #000;margin-top:10px}
.signature-section{margin-top:40px;display:flex;justify-content:space-between;gap:48px;break-inside:avoid}
.signature-box{flex:1;text-align:center}
.signature-line{border-top:1px solid #000;margin-top:48px;padding-top:6px;font-weight:600}
@media print{.print-note{display:none}}
</style>
</head>
<body>
${printHeader({
logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="company-logo" />` : `<div style="font-size: 28px; font-weight: bold; color: #1a56db; margin-bottom: 10px;">\u0645\u0635\u0631 \u0645\u0648\u062A\u0648\u0631\u0632</div>`}`,
company: {
nameAr: `${COMPANY_SETTINGS.nameAr}`,
nameEn: `${COMPANY_SETTINGS.nameEn}`,
detailsHtml: `<div>\u0627\u0644\u0639\u0646\u0648\u0627\u0646: ${COMPANY_SETTINGS.address}</div>
<div>\u062A\u0644\u064A\u0641\u0648\u0646: ${COMPANY_SETTINGS.phone} | \u0641\u0627\u0643\u0633: ${COMPANY_SETTINGS.fax}</div>
<div>\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A: ${COMPANY_SETTINGS.email}</div>`,
},
taxInfo: `${getTaxInfo()}`,
})}

${docTitle({ titleAr: `\u062A\u0642\u0631\u064A\u0631 \u0635\u064A\u0627\u0646\u0629`, numberLabel: `\u0631\u0642\u0645:`, number: `${escapeHtml(workOrder.work_order_number)}` })}

<div class="section">
<div class="pm-section-title">\u0628\u064A\u0627\u0646\u0627\u062A \u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0635\u064A\u0627\u0646\u0629</div>
<div class="pm-fields">
<div class="pm-field"><span class="pm-label">\u0631\u0642\u0645 \u0627\u0644\u062A\u0642\u0631\u064A\u0631:</span><span class="pm-value">${escapeHtml(workOrder.work_order_number)}</span></div>
<div class="pm-field"><span class="pm-label">\u0631\u0642\u0645 \u0623\u0645\u0631 \u0627\u0644\u0628\u064A\u0639:</span><span class="pm-value">${escapeHtml(salesOrder?.so_number || na)}</span></div>
<div class="pm-field"><span class="pm-label">\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0646\u0634\u0627\u0621:</span><span class="pm-value">${dateStr}</span></div>
<div class="pm-field"><span class="pm-label">\u0627\u0644\u062D\u0627\u0644\u0629:</span><span class="pm-value">${escapeHtml(statusAr)}</span></div>
<div class="pm-field"><span class="pm-label">\u0627\u0644\u0641\u0646\u064A \u0627\u0644\u0645\u0633\u0624\u0648\u0644:</span><span class="pm-value">${escapeHtml(assignedEmployeeName || na)}</span></div>
</div>
</div>

<div class="section">
<div class="pm-section-title">\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0645\u064A\u0644</div>
<div class="pm-fields">
<div class="pm-field"><span class="pm-label">\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064A\u0644:</span><span class="pm-value">${escapeHtml(customer?.customer_name || na)}</span></div>
<div class="pm-field"><span class="pm-label">\u0627\u0644\u0639\u0646\u0648\u0627\u0646 / \u0627\u0644\u0645\u0648\u0642\u0639:</span><span class="pm-value">${escapeHtml(customer?.address || workOrder.location || na)}</span></div>
<div class="pm-field"><span class="pm-label">\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641:</span><span class="pm-value">${escapeHtml(customer?.phone || na)}</span></div>
</div>
</div>

<div class="section">
<div class="pm-section-title">\u0648\u0635\u0641 \u0627\u0644\u0639\u0645\u0644</div>
<div class="pm-fields">
<div class="pm-field"><span class="pm-label">\u0627\u0644\u0639\u0646\u0648\u0627\u0646:</span><span class="pm-value">${escapeHtml(workOrder.title)}</span></div>
<div class="pm-field pm-field-wide"><span class="pm-label">\u0627\u0644\u0648\u0635\u0641:</span><span class="pm-value">${escapeHtml(workOrder.description)}</span></div>
<div class="pm-field"><span class="pm-label">\u0627\u0644\u062A\u0635\u0646\u064A\u0641:</span><span class="pm-value">${escapeHtml(categoryAr)}</span></div>
</div>
</div>

<div class="section">
<div class="pm-section-title">\u0627\u0644\u0645\u0648\u0627\u062F \u0648\u0627\u0644\u0642\u0637\u0639 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629</div>
<table class="pm-table">
<thead><tr><th>\u0648\u0635\u0641 \u0627\u0644\u0635\u0646\u0641</th><th>\u0627\u0644\u0643\u0645\u064A\u0629</th><th>\u0627\u0644\u0648\u062D\u062F\u0629</th><th>\u0645\u0644\u0627\u062D\u0638\u0627\u062A</th></tr></thead>
<tbody>
${emptyRows}
</tbody>
</table>
</div>

<div class="section">
<div class="pm-section-title">\u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0645\u0646\u0641\u0630\u0629 / \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A</div>
<div class="notes-section"></div>
</div>

<div class="signature-section">
<div class="signature-box"><div class="signature-line">\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0641\u0646\u064A / \u0627\u0644\u062A\u0627\u0631\u064A\u062E</div></div>
<div class="signature-box"><div class="signature-line">\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0639\u0645\u064A\u0644 / \u0627\u0644\u062A\u0627\u0631\u064A\u062E</div></div>
</div>

<div class="pm-note print-note">\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647 \u0622\u0644\u064A\u0627\u064B \u0645\u0646 \u0646\u0638\u0627\u0645 \u0645\u0635\u0631 \u0645\u0648\u062A\u0648\u0631\u0632 - \u064A\u0631\u062C\u0649 \u0637\u0628\u0627\u0639\u062A\u0647 \u0648\u062A\u0639\u0628\u0626\u062A\u0647 \u0645\u0646 \u0642\u0628\u0644 \u0641\u0631\u064A\u0642 \u0627\u0644\u0634\u062D\u0646</div>
</body>
</html>`

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="work-order-${String(workOrder.work_order_number).replace(/[^A-Za-z0-9._-]/g, "_")}.html"`,
      },
    })
  } catch (error) {
    console.error("Error generating PDF template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
