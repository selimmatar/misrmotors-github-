import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { withRetry } from "@/lib/supabase/rate-limit-handler"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml, ltrText } from "@/lib/html-escape"
import { PRINT_CSS, printHeader, docTitle, infoBox, PRINT_ROWS_SCRIPT } from "@/lib/print/print-theme"
import { followLineOrder, sortSoLines } from "@/lib/line-order"
import { lineKey, loadReturnLines, returnedByKey } from "@/lib/return-lines"
import { NOT_DELIVERED_AR, NOT_DELIVERED_EN, permitPrintLines } from "@/lib/dp-print-lines"

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

    // Fetch permit items, in the order of the sales order's lines (lib/line-order.ts), then permit-line id
    const { data: permitItems } = await withRetry(() =>
      supabase.from("delivery_permit_items").select("*").eq("permit_id", Number.parseInt(permitId)),
    )
    const soIdForOrder = (permit as any).sales_order_id
    const { data: soLinesForOrder } = soIdForOrder
      ? await supabase.from("sales_order_items").select("*").eq("so_id", soIdForOrder)
      : { data: [] as any[] }
    const items = followLineOrder(
      permitItems,
      sortSoLines(soLinesForOrder),
      (row: any) => lineKey(row.product_id, row.item_name_snapshot),
      (line: any) => lineKey(line.product_id, line.outsourced_name),
      "item_id",
    )

    // Returned / not received lines (owner request, 2026-11-22): every print of the permit shows them as not delivered,
    // with the quantity, and the total counts only what was delivered. A permit with no returns prints as before.
    const returnLines = await loadReturnLines(supabase, [Number.parseInt(permitId)])
    // (a failed read of the returns stops the print: printing returned items as delivered is what must not happen)
    const printed = permitPrintLines(
      (items || []).map((row: any) => ({ key: lineKey(row.product_id, row.item_name_snapshot), quantity: Number(row.quantity) || 0 })),
      returnedByKey(returnLines, { permitId: Number.parseInt(permitId) }),
    )
    const anyReturned = printed.lines.some((l) => l.notDelivered > 0)
    const qtyCell = (item: any, index: number) => {
      const l = printed.lines[index]
      if (!anyReturned || !l || l.notDelivered <= 0) return escapeHtml(toArabicNumbers(item.quantity))
      return l.delivered > 0
        ? `${escapeHtml(toArabicNumbers(l.delivered))}<div class="pm-nd">من ${escapeHtml(toArabicNumbers(l.quantity))}</div>`
        : `<s>${escapeHtml(toArabicNumbers(l.quantity))}</s>`
    }
    const noteCell = (index: number) => {
      const l = printed.lines[index]
      if (!anyReturned || !l || l.notDelivered <= 0) return ""
      return l.delivered > 0
        ? `<span class="pm-nd">${NOT_DELIVERED_AR} / ${NOT_DELIVERED_EN}: ${escapeHtml(toArabicNumbers(l.notDelivered))}</span><div>تم التسليم / Delivered: ${escapeHtml(toArabicNumbers(l.delivered))}</div>`
        : `<span class="pm-nd">${NOT_DELIVERED_AR} / ${NOT_DELIVERED_EN} (${escapeHtml(toArabicNumbers(l.notDelivered))})</span>`
    }
    const totalsRow = anyReturned
      ? `<tfoot><tr class="pm-total"><td></td><td class="pm-num">${escapeHtml(toArabicNumbers(printed.deliveredTotal))}</td><td colspan="3">إجمالي المُسلَّم / Total delivered${printed.notDeliveredTotal > 0 ? ` · ${NOT_DELIVERED_AR} / ${NOT_DELIVERED_EN}: ${escapeHtml(toArabicNumbers(printed.notDeliveredTotal))}` : ""}</td></tr></tfoot>`
      : ""

    // Generate HTML for PDF (Arabic RTL)
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>إذن تسليم - ${escapeHtml(permit.permit_no)}</title>
  <style>
    ${PRINT_CSS}
    .pm-table td.description { text-align: start; }
    .pm-sign { font-size: 13px; color: #000; }${anyReturned ? `
    .pm-nd { color: #b91c1c; font-weight: 700; font-size: 12px; }
    .pm-total td { font-weight: 700; border-top: 2px solid #000; }` : ""}
    .print-button { position: fixed; top: 10px; left: 10px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; z-index: 1000; }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ طباعة</button>
  
  ${printHeader({
    logoHtml: `${logoDataUrl ? `<img src="${logoDataUrl}" alt="Misr Motors Logo" class="company-logo" />` : `<div style="font-size: 28px; font-weight: bold; color: #1a56db; margin-bottom: 10px;">مصر موتورز</div>`}`,
    company: {
      nameAr: `${COMPANY_SETTINGS.nameAr}`,
      nameEn: `${COMPANY_SETTINGS.nameEn}`,
      detailsHtml: `<div>العنوان: ${COMPANY_SETTINGS.address}</div>
      <div>تليفون: ${ltrText(COMPANY_SETTINGS.phone)} | فاكس: ${ltrText(COMPANY_SETTINGS.fax)}</div>
      <div>البريد الإلكتروني: ${ltrText(COMPANY_SETTINGS.email)}</div>`,
    },
    taxInfo: `${getTaxInfo()}`,
  })}
  
  ${docTitle({ titleAr: `إذن تسليم` })}
  
  ${infoBox(``, [
    [`رقم إذن تسليم (DP):`, `${escapeHtml(permit.permit_no)}`],
    [`التاريخ:`, `${formatArabicDate(permit.created_at || new Date().toISOString())}`],
    [`رقم أمر البيع (SO):`, `${escapeHtml(permit.sales_orders?.so_number || "-")}`],
    [`رقم طلب العرض (QR):`, `${escapeHtml(permit.sales_orders?.quotation_request_number || permit.qr_number || "-")}`],
    [`يسلم إلى:`, `${escapeHtml(permit.recipient_name || permit.sales_orders?.delivery_contact_name || permit.customers?.customer_name || "-")}`, true],
    [`العنوان:`, `${escapeHtml(permit.delivery_address || permit.sales_orders?.delivery_address || permit.customers?.address || "-")}`, true],
    [`تليفون:`, ltrText(permit.recipient_phone || permit.sales_orders?.delivery_contact_phone || permit.customers?.phone || "-")],
  ])}
  
  <!-- Items Table - EXACT COLUMNS -->
  <table class="pm-table">
    <thead>
      <tr>
        <th style="width: 8%;">مسلسل</th>
        <th class="pm-num" style="width: 10%;">عدد</th>
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
          <td class="pm-num">${qtyCell(item, index)}</td>
          <td class="description">${escapeHtml(item.item_name_snapshot || "-")}</td>
          <td>${escapeHtml(item.sku_snapshot || "-")}</td>
          <td>${noteCell(index)}</td>
        </tr>
      `,
        )
        .join("")}
    </tbody>${totalsRow}
  </table>
  
  <!-- Footer Section -->
  <div class="pm-note" style="font-weight: 700;">
    استلمت المواد المذكورة أعلاه في حالة جيدة
  </div>
  <div class="pm-note">
    <strong>ملاحظة:</strong> التوقيع يشمل الموافقة على شروط البيع خلفه
  </div>
  <div class="pm-signatures">
    <div class="pm-sign"><strong>تحريرًا في:</strong> _______________</div>
    <div class="pm-sign"><strong>توقيع المستلم:</strong> _______________</div>
  </div>
${PRINT_ROWS_SCRIPT}
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
