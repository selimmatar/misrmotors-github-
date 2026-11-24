import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_SETTINGS, getTaxInfo } from "@/lib/company-settings"
import { escapeHtml, ltrText } from "@/lib/html-escape"
import { moneyCell } from "@/lib/print-html"
import { PRINT_CSS, printHeader, docTitle, PRINT_ROWS_SCRIPT } from "@/lib/print/print-theme"
import {
  VAT_RATE,
  computeWholeOrderAmount,
  etaUnitPrice,
  loadSoInvoicingState,
  loadStandaloneLines,
  orderDiscountRate,
  round2,
} from "@/lib/invoicing"
import { vatPrintTotals } from "@/lib/vat-lines"
import { mergePrintItems } from "@/lib/merge-lines"
import { replacedPrint } from "@/lib/eta/replaced-print"
import { lineKey, loadReturnLines, netLineQuantities, returnedByKey, toMs } from "@/lib/return-lines"
import { followLineOrder, sortSoLines } from "@/lib/line-order"

// Item name - outsourced_name for outsourced items, product_name for stock items
const printItemName = (item: any): string =>
  item.item_type === "outsourced" ? item.outsourced_name || "صنف خارجي" : item.products?.product_name || "-"

export const dynamic = "force-dynamic"

// Format date with English numbers
function formatInvoiceDate(dateStr: string): string {
  if (!dateStr) return "-"
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

// Format number with English numerals
function formatEnglishNumber(num: number | string): string {
  return String(num)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    
    const invoiceId = Number.parseInt(id)

    if (!id || !invoiceId || isNaN(invoiceId)) {
      console.error("AR Invoice PDF - Invalid invoice ID. Raw:", id, "Parsed:", invoiceId)
      return NextResponse.json({ error: "Invalid invoice ID", details: { received: id, parsed: invoiceId } }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch AR invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_receivable")
      .select(`
        *,
        customers:customer_id (customer_name, phone, address, city),
        sales_orders:so_id (
          so_id,
          so_number,
          order_date,
          total,
          subtotal,
          discount_amount,
          payment_type,
          payment_terms,
          quotation_request_number,
          quotation_request_file_name,
          department_name,
          receiver_name,
          delivery_contact_name,
          delivery_contact_phone,
          sales_order_items (
            *,
            products:product_id (product_name, sku)
          )
        )
      `)
      .eq("invoice_id", invoiceId)
      .single()

    if (invoiceError || !invoice) {
      console.error("AR Invoice PDF - Invoice not found:", invoiceId, invoiceError)
      return new NextResponse(generateErrorHtml("فاتورة العميل غير موجودة", `Invoice ID: ${id}`), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const customer = invoice.customers || {}
    const so = invoice.sales_orders || {}
    const qrNumber = so.quotation_request_number || null
    // A replaced invoice (correct and reissue, spec §6.5a) prints what was sent to the tax portal, with "Replaced by".
    const replaced = await replacedPrint(supabase, invoice)

    // A single sales order can have multiple delivery permits, each invoiced
    // separately. Find the delivery permit(s) actually linked to THIS invoice
    // (via invoice_delivery_permits) - if any exist, this invoice only covers
    // those DPs' items, not every item on the whole sales order.
    const { data: dpLinks } = replaced ? { data: [] as any[] } : await supabase
      .from("invoice_delivery_permits")
      .select(
        `
        permit_id,
        delivery_permits:permit_id (
          permit_id,
          permit_no,
          status,
          delivery_permit_items (
            item_id,
            product_id,
            quantity,
            unit_price,
            total,
            item_name_snapshot
          )
        )
      `,
      )
      .eq("invoice_id", invoiceId)

    // The order's lines in their saved order; a delivery permit's lines follow the same order.
    if (invoice.sales_orders) invoice.sales_orders.sales_order_items = sortSoLines(invoice.sales_orders.sales_order_items)
    const soLineKey = (line: any) => lineKey(line.product_id, line.outsourced_name)
    const linkedPermits = (dpLinks || []).map((link: any) => link.delivery_permits).filter(Boolean)
    for (const permit of linkedPermits) {
      permit.delivery_permit_items = followLineOrder(
        permit.delivery_permit_items,
        invoice.sales_orders?.sales_order_items,
        (row: any) => lineKey(row.product_id, row.item_name_snapshot),
        soLineKey,
        "item_id",
      )
    }
    const isDpBasedInvoice = linkedPermits.length > 0

    // Items shown on the invoice: only the linked DP's items for a DP-based
    // invoice, otherwise every item on the sales order (invoice created
    // directly from the SO with no specific DP subset).
    // Batch 2: a delivery-permit invoice was priced net of the returns that existed when it was created
    // (lib/invoicing.ts), so the printed lines must be net of the same returns. Returns filed after the invoice
    // never change it. With no such returns the lines are exactly what they were before.
    const invoiceMs = toMs(invoice.created_at)
    const returnLines = isDpBasedInvoice ? await loadReturnLines(supabase, linkedPermits.map((p: any) => p.permit_id)) : []
    let items = replaced
      ? (replaced.lines || []).map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, total: l.total, item_type: null, outsourced_name: null, products: { product_name: l.name } }))
      : isDpBasedInvoice
      ? linkedPermits.flatMap((permit: any) => {
          const rows: any[] = permit.delivery_permit_items || []
          const net = netLineQuantities(
            rows.map((row) => ({ key: lineKey(row.product_id, row.item_name_snapshot), quantity: Number(row.quantity) || 0 })),
            returnedByKey(returnLines, { permitId: permit.permit_id, asOfMs: Number.isNaN(invoiceMs) ? Number.NEGATIVE_INFINITY : invoiceMs }),
          )
          return rows
            .map((item: any, idx: number) => {
              const originalQty = Number(item.quantity) || 0
              const unchanged = net[idx] === originalQty
              const lineTotal = Number(item.total) || (Number(item.unit_price) || 0) * originalQty
              return {
                product_id: item.product_id ?? null,
                quantity: unchanged ? item.quantity : net[idx],
                unit_price: item.unit_price,
                total: unchanged ? item.total : originalQty > 0 ? (lineTotal * net[idx]) / originalQty : 0,
                item_type: null,
                outsourced_name: null,
                products: { product_name: item.item_name_snapshot },
              }
            })
            .filter((item: any) => Number(item.quantity) > 0)
        })
      : invoice.sales_orders?.sales_order_items || []

    // Batch 2: a whole-order invoice leaves out the quantity returned before it was created, so its printed lines
    // must too (the stored amount is already net). With no such returns the lines are exactly the order's lines.
    if (!replaced && !isDpBasedInvoice && invoice.so_id) {
      const state = await loadSoInvoicingState(supabase, invoice.so_id)
      if (state && state.returns.length > 0) {
        const asOf = Number.isNaN(invoiceMs) ? Number.NEGATIVE_INFINITY : invoiceMs
        const priced = computeWholeOrderAmount({ ...state, returns: state.returns.filter((r) => toMs(r.created_at) <= asOf) })
        if (priced.ok && priced.excluded.size > 0) {
          const left = new Map(priced.excluded)
          for (let i = 0; i < items.length; i++) {
            const item: any = items[i]
            const key = lineKey(item.product_id, item.outsourced_name)
            const qty = Number(item.quantity) || 0
            const take = Math.min(left.get(key) || 0, qty)
            if (take <= 0) continue
            left.set(key, (left.get(key) || 0) - take)
            const lineTotal = Number(item.total) || (Number(item.unit_price) || 0) * qty
            items[i] = { ...item, quantity: qty - take, total: qty > 0 ? (lineTotal * (qty - take)) / qty : 0 }
          }
          items = items.filter((item: any) => Number(item.quantity) > 0)
        }
      }
    }

    // A standalone MINV (no sales order, no permits) prints its own lines.
    if (!replaced && !isDpBasedInvoice && !invoice.so_id) {
      items = (await loadStandaloneLines(supabase, invoice.invoice_id)).map((l) => ({
        quantity: l.quantity,
        unit_price: l.unitPrice,
        total: round2(l.quantity * l.unitPrice),
        item_type: "outsourced",
        outsourced_name: l.name,
        products: { product_name: l.name },
      }))
    }

    // Delivery permits listed in the invoice header: only the ones linked to
    // THIS invoice, not every DP ever created for the sales order.
    const deliveryPermits = isDpBasedInvoice
      ? linkedPermits.map((permit: any) => ({
          permit_id: permit.permit_id,
          permit_no: permit.permit_no,
          status: permit.status,
        }))
      : []

    // VAT per line (lib/vat-lines.ts, owner 2026-11-22): the printed VAT is the sum of the line VATs (each line's net
    // after the order's discount x 14 %, rounded on the line) and the total the sum of the line nets + VATs, as the
    // e-invoice adds it up. The printed total must equal the stored invoice amount: when the per-line sum differs from
    // it (an invoice stored before VAT was rounded per line, or an order edited after invoicing) the stored amount is
    // printed as the total, split into before-VAT and VAT - legal amounts never change silently.
    const soSubtotal = Number(so.subtotal) || 0
    const soDiscount = Number(so.discount_amount) || 0
    const VAT_RATE_PDF = 1 + VAT_RATE

    let totalWithVat: number
    let subtotalBeforeVat: number
    let vatAmount: number
    if (replaced) {
      // the sent document's totals; without one, the stored amount
      totalWithVat = replaced.totals ? round2(replaced.totals.total) : round2(Number(invoice.amount) || 0)
      subtotalBeforeVat = replaced.totals ? round2(replaced.totals.net) : round2(totalWithVat / VAT_RATE_PDF)
      vatAmount = replaced.totals ? round2(replaced.totals.vat) : round2(totalWithVat - subtotalBeforeVat)
    } else {
      const discountRate = invoice.so_id ? orderDiscountRate(so.sales_order_items || [], soSubtotal, soDiscount) : 0
      const priceOf = (rows: any[]) =>
        vatPrintTotals(rows.map((item: any) => ({ quantity: Number(item.quantity) || 0, unitPrice: etaUnitPrice(item) })), discountRate, invoice.amount)
      // One row per item (lib/merge-lines.ts, owner 2026-11-24): the same product (or name) at the same unit price on
      // several permits prints once with the summed quantity, as the e-invoice sends it. An invoice stored before lines
      // were merged whose amount matches its unmerged rows exactly keeps printing those rows.
      const merged = mergePrintItems(items, (item: any) => etaUnitPrice(item), printItemName)
      let printed = priceOf(merged)
      if (printed.storedDiffers && merged.length !== items.length) {
        const unmerged = priceOf(items)
        if (!unmerged.storedDiffers) printed = unmerged
        else items = merged
      } else items = merged
      ;({ totalWithVat, subtotalBeforeVat, vatAmount } = printed)
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

    // Generate HTML invoice
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>فاتورة - ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    ${PRINT_CSS}
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
  
  <!-- Document Title -->
  ${docTitle({ titleAr: `فاتورة` })}${
    replaced
      ? `
  <div class="pm-field pm-field-wide" style="border: 2px solid #b91c1c; padding: 6px 10px; margin: 8px 0; font-weight: 700;"><span class="pm-label">${escapeHtml(replaced.note.ar)}</span> <span class="pm-value" dir="ltr">${escapeHtml(replaced.note.en)}</span></div>`
      : ""
  }
  
  <!-- Invoice Info -->
  <section class="pm-info">
  <div class="pm-fields">
    <div class="pm-field pm-field-wide">
      <span class="pm-label">رقم الفاتورة:</span>
      <span class="pm-value">${escapeHtml(invoice.invoice_number)}</span>
    </div>
    <div class="pm-field pm-field-wide">
      <span class="pm-label">التاريخ:</span>
      <span class="pm-value">${formatInvoiceDate(invoice.invoice_date)}</span>
    </div>
    ${
      qrNumber
        ? `<div class="pm-field pm-field-wide">
      <span class="pm-label">رقم طلب التسعير:</span>
      <span class="pm-value">${escapeHtml(qrNumber)}</span>
    </div>`
        : ""
    }
    ${
      deliveryPermits.length > 0
        ? `<div class="pm-field pm-field-wide">
      <span class="pm-label">أذونات التسليم:</span>
      <span class="pm-value">${deliveryPermits.map((dp: any) => escapeHtml(dp.permit_no)).join(" - ")}</span>
    </div>`
        : ""
    }
    <div class="pm-field pm-field-wide">
      <span class="pm-label">المطلوب من السيد:</span> <span class="pm-value">${escapeHtml(customer.customer_name || "-")}</span>
    </div>
    ${
      so.department_name
        ? `<div class="pm-field pm-field-wide">
      <span class="pm-label">القسم ورقم طلب التسعير:</span> <span class="pm-value">${escapeHtml(so.department_name)}</span>
    </div>`
        : ""
    }
    ${
      so.receiver_name || so.delivery_contact_name
        ? `<div class="pm-field pm-field-wide">
      <span class="pm-label">اسم المستلم:</span> <span class="pm-value">${escapeHtml(so.receiver_name || so.delivery_contact_name)}${so.delivery_contact_phone ? ` - تليفون: ${ltrText(so.delivery_contact_phone)}` : ""}</span>
    </div>`
        : ""
    }
    <div class="pm-field pm-field-wide">
      <span class="pm-label">العنوان:</span> <span class="pm-value">${escapeHtml(customer.address || "-")}, ${escapeHtml(customer.city || "-")}</span>
    </div>
  </div>
  </section>
  
  <!-- Items Table - EXACT COLUMNS -->
  <table class="items-table pm-table">
    <thead>
      <tr>
        <th class="pm-center" style="width: 8%;">عدد</th>
        <th style="width: 40%;">البيان</th>
        <th class="pm-num" style="width: 26%;">سعر الوحدة (جنيه)</th>
        <th class="pm-num" style="width: 26%;">القيمة (جنيه)</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map((item: any) => {
          const unitPrice = Number(item.unit_price) || 0
          const quantity = Number(item.quantity) || 0
          const itemTotal = Number(item.total) || (unitPrice * quantity)
          
          // Get item name - use outsourced_name for outsourced items, product_name for stock items
          const itemName = item.item_type === 'outsourced' 
            ? (item.outsourced_name || 'صنف خارجي') 
            : (item.products?.product_name || '-')

          return `
        <tr>
          <td class="center pm-center">${quantity}</td>
          <td>${escapeHtml(itemName)}</td>
          ${moneyCell(unitPrice)}
          ${moneyCell(itemTotal)}
        </tr>
      `
        })
        .join("")}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" class="pm-num">المجموع الفرعي</td>
        ${moneyCell(subtotalBeforeVat)}
      </tr>
      <tr>
        <td colspan="3" class="pm-num">ضريبة القيمة المضافة (14%)</td>
        ${moneyCell(vatAmount)}
      </tr>
      <tr class="pm-total-final">
        <td colspan="3" class="pm-num">إجمالي الفاتورة</td>
        ${moneyCell(totalWithVat)}
      </tr>
    </tfoot>
  </table>
  
  <!-- Footer -->
  <div class="pm-signatures">
    <div class="pm-sign">
      <div class="pm-sign-label">الحسابات</div>
      <div class="pm-sign-line"></div>
    </div>
    <div class="pm-sign">
      <div class="pm-sign-label">توقيع المستلم</div>
      <div class="pm-sign-line"></div>
    </div>
    <div class="pm-sign">
      <div class="pm-sign-label">ختم الشركة</div>
      <div class="pm-sign-line"></div>
    </div>
  </div>
${PRINT_ROWS_SCRIPT}
</body>
</html>
    `

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    console.error("AR Invoice PDF error:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}

function generateErrorHtml(title: string, details: string): string {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>خطأ</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f3f4f6; }
    .error-box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
    h1 { color: #16a34a; }
    .details { font-size: 12px; color: #9ca3af; background: #f9fafb; padding: 10px; border-radius: 5px; margin-top: 15px; }
    button { background: #16a34a; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>⚠️ ${escapeHtml(title)}</h1>
    <div class="details">${escapeHtml(details)}</div>
    <button onclick="window.close()">إغلاق</button>
  </div>
</body>
</html>
  `
}
