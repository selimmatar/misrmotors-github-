import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"

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
      console.error("[v0] Failed to load logo:", e)
    }

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4;margin:15mm}
body{font-family:'Noto Naskh Arabic','Arial',sans-serif;font-size:12pt;line-height:1.4;color:#000;background:white;direction:rtl}
.company-header{text-align:center;border-bottom:2px solid #000;padding:10px;margin-bottom:5mm;display:flex;flex-direction:column;align-items:center}
.company-logo{width:80px;height:80px;object-fit:contain;margin-bottom:10px}
.company-name-ar{font-size:18pt;font-weight:700;margin-bottom:3px}
.company-name-en{font-size:14pt;font-weight:600;margin-bottom:8px}
.company-details{font-size:10pt;line-height:1.6}
.tax-info{font-size:9pt;margin-top:5px;border-top:1px solid #ccc;padding-top:5px}
.doc-title{text-align:center;font-size:20pt;font-weight:700;margin:10mm 0;text-decoration:underline}
.section{margin-bottom:25px}
.section-title{font-weight:700;font-size:16px;color:#fff;background:#1a365d;padding:8px 15px;margin-bottom:10px;border-radius:4px}
.field{margin:8px 0;display:flex;border-bottom:1px dotted #ddd;padding-bottom:5px}
.field-label{font-weight:600;width:200px;color:#333}
.field-value{flex:1;color:#000}
.table{width:100%;border-collapse:collapse;margin-top:15px}
.table th,.table td{border:1px solid #999;padding:10px;text-align:right}
.table th{background:#1a365d;color:#fff;font-weight:600}
.notes-section{min-height:180px;border:2px solid #ccc;padding:15px;margin-top:10px;border-radius:4px}
.signature-section{margin-top:50px;display:flex;justify-content:space-between}
.signature-box{width:45%;text-align:center}
.signature-line{border-top:2px solid #000;margin-top:60px;padding-top:8px;font-weight:600}
.print-note{text-align:center;color:#999;font-size:11px;margin-top:30px;border-top:1px solid #eee;padding-top:10px}
@media print{body{margin:20px}.print-note{display:none}}
</style>
</head>
<body>
<div class="company-header">
${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="company-logo" />` : `<div style="font-size: 28px; font-weight: bold; color: #1a56db; margin-bottom: 10px;">\u0645\u0635\u0631 \u0645\u0648\u062A\u0648\u0631\u0632</div>`}
<div class="company-name-ar">${COMPANY_SETTINGS.nameAr}</div>
<div class="company-name-en">${COMPANY_SETTINGS.nameEn}</div>
<div class="company-details">
<div>\u0627\u0644\u0639\u0646\u0648\u0627\u0646: ${COMPANY_SETTINGS.address}</div>
<div>\u062A\u0644\u064A\u0641\u0648\u0646: ${COMPANY_SETTINGS.phone} | \u0641\u0627\u0643\u0633: ${COMPANY_SETTINGS.fax}</div>
<div>\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A: ${COMPANY_SETTINGS.email}</div>
</div>
<div class="tax-info">${getTaxInfo()}</div>
</div>

<div class="doc-title">\u062A\u0642\u0631\u064A\u0631 \u0635\u064A\u0627\u0646\u0629 \u0631\u0642\u0645: ${workOrder.work_order_number}</div>

<div class="section">
<div class="section-title">\u0628\u064A\u0627\u0646\u0627\u062A \u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0635\u064A\u0627\u0646\u0629</div>
<div class="field"><span class="field-label">\u0631\u0642\u0645 \u0627\u0644\u062A\u0642\u0631\u064A\u0631:</span><span class="field-value">${workOrder.work_order_number}</span></div>
<div class="field"><span class="field-label">\u0631\u0642\u0645 \u0623\u0645\u0631 \u0627\u0644\u0628\u064A\u0639:</span><span class="field-value">${salesOrder?.so_number || na}</span></div>
<div class="field"><span class="field-label">\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0646\u0634\u0627\u0621:</span><span class="field-value">${dateStr}</span></div>
<div class="field"><span class="field-label">\u0627\u0644\u062D\u0627\u0644\u0629:</span><span class="field-value">${statusAr}</span></div>
<div class="field"><span class="field-label">\u0627\u0644\u0641\u0646\u064A \u0627\u0644\u0645\u0633\u0624\u0648\u0644:</span><span class="field-value">${assignedEmployeeName || na}</span></div>
</div>

<div class="section">
<div class="section-title">\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0645\u064A\u0644</div>
<div class="field"><span class="field-label">\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064A\u0644:</span><span class="field-value">${customer?.customer_name || na}</span></div>
<div class="field"><span class="field-label">\u0627\u0644\u0639\u0646\u0648\u0627\u0646 / \u0627\u0644\u0645\u0648\u0642\u0639:</span><span class="field-value">${customer?.address || workOrder.location || na}</span></div>
<div class="field"><span class="field-label">\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641:</span><span class="field-value">${customer?.phone || na}</span></div>
</div>

<div class="section">
<div class="section-title">\u0648\u0635\u0641 \u0627\u0644\u0639\u0645\u0644</div>
<div class="field"><span class="field-label">\u0627\u0644\u0639\u0646\u0648\u0627\u0646:</span><span class="field-value">${workOrder.title}</span></div>
<div class="field"><span class="field-label">\u0627\u0644\u0648\u0635\u0641:</span><span class="field-value">${workOrder.description}</span></div>
<div class="field"><span class="field-label">\u0627\u0644\u062A\u0635\u0646\u064A\u0641:</span><span class="field-value">${categoryAr}</span></div>
</div>

<div class="section">
<div class="section-title">\u0627\u0644\u0645\u0648\u0627\u062F \u0648\u0627\u0644\u0642\u0637\u0639 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629</div>
<table class="table">
<thead><tr><th>\u0648\u0635\u0641 \u0627\u0644\u0635\u0646\u0641</th><th>\u0627\u0644\u0643\u0645\u064A\u0629</th><th>\u0627\u0644\u0648\u062D\u062F\u0629</th><th>\u0645\u0644\u0627\u062D\u0638\u0627\u062A</th></tr></thead>
<tbody>
${emptyRows}
</tbody>
</table>
</div>

<div class="section">
<div class="section-title">\u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0645\u0646\u0641\u0630\u0629 / \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A</div>
<div class="notes-section"></div>
</div>

<div class="signature-section">
<div class="signature-box"><div class="signature-line">\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0641\u0646\u064A / \u0627\u0644\u062A\u0627\u0631\u064A\u062E</div></div>
<div class="signature-box"><div class="signature-line">\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0639\u0645\u064A\u0644 / \u0627\u0644\u062A\u0627\u0631\u064A\u062E</div></div>
</div>

<div class="print-note">\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647 \u0622\u0644\u064A\u0627\u064B \u0645\u0646 \u0646\u0638\u0627\u0645 \u0645\u0635\u0631 \u0645\u0648\u062A\u0648\u0631\u0632 - \u064A\u0631\u062C\u0649 \u0637\u0628\u0627\u0639\u062A\u0647 \u0648\u062A\u0639\u0628\u0626\u062A\u0647 \u0645\u0646 \u0642\u0628\u0644 \u0641\u0631\u064A\u0642 \u0627\u0644\u0634\u062D\u0646</div>
</body>
</html>`

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="work-order-${workOrder.work_order_number}.html"`,
      },
    })
  } catch (error) {
    console.error("[v0] Error generating PDF template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
