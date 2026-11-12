// Sales order print (Batch 3): Arabic RTL A4 HTML built from saved data. Pure; used by GET /api/sales-orders/print.
import { escapeHtml, moneyCell, renderSoTotalsBlock, TOTALS_BLOCK_CSS } from "./print-html"
import { computeSoPrintTotals } from "./print-totals"
import { PRINT_CSS, printHeader, docTitle, PRINT_ROWS_SCRIPT } from "./print/print-theme"

export interface SoPrintData {
  so: Record<string, any>
  customer: { customer_name?: string; phone?: string; email?: string } | null
  items: { name: string; quantity: number; unit_price: number; total: number; returned: number; delivered?: number }[]
  /**
   * Delivery print (owner request, 2026-11-12). "status": every line with Delivered / Remaining and a mark; "delivered":
   * only what was delivered, valued at the order prices. Delivered = on signed or approved permits, less returns.
   */
  delivery?: { mode: "status" | "delivered"; permits: { number: string; date: string | null; status: string }[] }
}

const DP_STATUS_AR: Record<string, string> = {
  DRAFT: "مسودة",
  READY_FOR_SHIPMENT: "جاهز للشحن",
  PRINTED: "تمت الطباعة",
  READY_FOR_PICKUP: "جاهز للاستلام",
  OUT_FOR_DELIVERY: "خرج للتسليم",
  SUBMITTED_SIGNED: "تم التوقيع والتسليم",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
}

const PAYMENT_AR: Record<string, string> = {
  cash: "نقدي",
  prepaid: "الدفع مقدماً",
  installments: "تقسيط",
  installment: "تقسيط",
  hybrid: "دفعة مقدمة + أقساط",
  cheque: "شيك",
  bank_transfer: "تحويل بنكي",
  credit: "آجل",
}
const STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  pending: "قيد الانتظار",
  pending_accountant: "بانتظار المحاسب",
  accountant_approved: "معتمد",
  ready_for_delivery: "جاهز للتسليم",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
}

const dateAr = (value: unknown) => {
  if (!value) return "-"
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return "-"
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
}
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const egp = (v: unknown) => n(v).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function renderSoPrintHtml(data: SoPrintData): string {
  const { so, customer, delivery } = data
  const deliveredOnly = delivery?.mode === "delivered"
  const withStatus = delivery?.mode === "status"
  // Delivered only: what went out, at the order prices; the order's discount applies in the same proportion.
  const items = deliveredOnly
    ? data.items
        .filter((i) => n(i.delivered) > 0)
        .map((i) => ({ ...i, quantity: n(i.delivered), total: Math.round(n(i.delivered) * n(i.unit_price) * 100) / 100 }))
    : data.items
  const fullSubtotal = data.items.reduce((s, i) => s + n(i.total), 0)
  const subtotal = items.reduce((s, i) => s + n(i.total), 0)
  const share = fullSubtotal > 0 ? subtotal / fullSubtotal : 0
  const discountAmount = deliveredOnly ? Math.round(n(so.discount_amount) * share * 100) / 100 : n(so.discount_amount)
  const deliveredTotal = deliveredOnly
    ? computeSoPrintTotals({ subtotal, discountType: so.discount_type, discountValue: n(so.discount_value), discountAmount, storedTotal: 0, storedNetTotal: null }).total
    : 0
  const totals = computeSoPrintTotals({
    subtotal,
    discountType: so.discount_type,
    discountValue: n(so.discount_value),
    discountAmount,
    storedTotal: deliveredOnly ? deliveredTotal : n(so.total),
    // The sales order prints as it stands: a returned item is either replaced (a normal line), kept as a "returned"
    // line at quantity 0, or removed, so no "returns / adjustments" line is printed (owner request, 2026-11-11).
    storedNetTotal: null,
  })

  const mark = (ordered: number, delivered: number) =>
    ordered > 0 && delivered >= ordered ? "✓ تم التسليم" : delivered > 0 ? "جزئي" : "لم يُسلَّم"
  const rows = items
    .map(
      (item, idx) => `
      <tr>
        <td class="center">${idx + 1}</td>
        <td>${escapeHtml(item.name)}${item.returned > 0 ? `<div class="returned">مرتجع: ${item.returned}</div>` : ""}</td>
        <td class="center">${n(item.quantity)}</td>${
          withStatus
            ? `
        <td class="center">${n(item.delivered)}</td>
        <td class="center">${Math.max(0, n(item.quantity) - n(item.delivered))}</td>
        <td class="center">${mark(n(item.quantity), n(item.delivered))}</td>`
            : ""
        }
        ${moneyCell(n(item.unit_price))}
        ${moneyCell(n(item.total))}
      </tr>`,
    )
    .join("")
  // With delivery status: the value of what was delivered and what is still to go (order prices, the order's
  // discount in proportion, 14% VAT), owner request 2026-11-12.
  let deliveredValueBox = ""
  if (withStatus) {
    const deliveredSub = data.items.reduce((s, i) => s + n(i.delivered) * n(i.unit_price), 0)
    const shareD = fullSubtotal > 0 ? deliveredSub / fullSubtotal : 0
    const dTotals = computeSoPrintTotals({
      subtotal: deliveredSub,
      discountType: so.discount_type,
      discountValue: n(so.discount_value),
      discountAmount: Math.round(n(so.discount_amount) * shareD * 100) / 100,
      storedTotal: 0,
      storedNetTotal: null,
    })
    const remaining = Math.max(0, Math.round((totals.total - dTotals.total) * 100) / 100)
    deliveredValueBox = `<div class="pm-note"><strong>قيمة الأصناف المُسلَّمة (شامل الضريبة):</strong> ${egp(dTotals.total)} جنيه &nbsp;|&nbsp; <strong>المتبقي للتسليم:</strong> ${egp(remaining)} جنيه</div>`
  }
  const permitsBox =
    delivery && delivery.permits.length > 0
      ? `<div class="pm-note"><strong>أذون التسليم:</strong><div style="margin-top:6px;font-size:10pt;">${delivery.permits
          .map((p) => `${escapeHtml(p.number)} · ${dateAr(p.date)} · ${escapeHtml(DP_STATUS_AR[p.status] || p.status)}`)
          .join(" &nbsp;|&nbsp; ")}</div><div style="font-size:9pt;color:#555;margin-top:4px;">المُسلَّم = ما على أذون موقّعة أو معتمدة، بعد خصم المرتجعات.</div></div>`
      : ""

  const type = String(so.payment_type || so.payment_terms || "cash")
  const details: string[] = []
  if ((type === "installments" || type === "installment") && so.remaining_installment_months) details.push(`عدد الأشهر: ${escapeHtml(so.remaining_installment_months)}`)
  if (type === "installments" && so.monthly_amount) details.push(`القسط الشهري: ${egp(so.monthly_amount)} جنيه`)
  if (type === "hybrid") {
    if (so.down_payment_amount) details.push(`الدفعة المقدمة: ${egp(so.down_payment_amount)} جنيه`)
    if (so.remaining_amount) details.push(`المبلغ المتبقي: ${egp(so.remaining_amount)} جنيه`)
  }
  if (type === "cheque") {
    if (so.cheque_number) details.push(`رقم الشيك: ${escapeHtml(so.cheque_number)}`)
    if (so.cheque_bank_name) details.push(`البنك: ${escapeHtml(so.cheque_bank_name)}`)
    if (so.cheque_due_date) details.push(`تاريخ الاستحقاق: ${dateAr(so.cheque_due_date)}`)
    if (so.cheque_amount) details.push(`المبلغ: ${egp(so.cheque_amount)} جنيه`)
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>أمر بيع - ${escapeHtml(so.so_number)}</title>
  <style>
    ${PRINT_CSS}${TOTALS_BLOCK_CSS}
    .center { text-align: center; }
    .returned { font-weight: 600; }
    .print-button { position: fixed; top: 10px; left: 10px; padding: 8px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">طباعة</button>
  ${printHeader({
    logoHtml: `<img src="/images/image.png" alt="Misr Motors Logo" class="company-logo" onerror="this.style.display='none'" />`,
    company: {
      nameAr: `شركة مصر للمحركات`,
      nameEn: `Misr Motors Co.`,
      detailsHtml: `<div>العنوان: 212 ش السودان - ميدان لبنان - المهندسين - الجيزة</div>
      <div>تليفون: 02-33039811 | فاكس: 02-33039818</div>
      <div>البريد الإلكتروني: sales@misrmotors.com</div>`,
    },
    taxInfo: `بطاقة ضريبية رقم: 2001 | ملف ضريبة: 10-191-343-5 | رقم التسجيل: 455-050-100`,
  })}

  ${docTitle({ titleAr: deliveredOnly ? `أمر بيع - الأصناف المُسلَّمة` : withStatus ? `أمر بيع - حالة التسليم` : `أمر بيع` })}

  <div class="pm-info"><div class="pm-fields">
    <div class="pm-field"><div class="pm-label">رقم أمر البيع:</div><div class="pm-value">${escapeHtml(so.so_number)}</div></div>
    <div class="pm-field"><div class="pm-label">التاريخ:</div><div class="pm-value">${dateAr(so.order_date)}</div></div>
    <div class="pm-field pm-field-wide"><div class="pm-label">السادة:</div><div class="pm-value">${escapeHtml(customer?.customer_name || "-")}</div></div>
    <div class="pm-field"><div class="pm-label">الحالة:</div><div class="pm-value">${escapeHtml(STATUS_AR[so.status] || so.status || "-")}</div></div>
    ${customer?.phone ? `<div class="pm-field"><div class="pm-label">الهاتف:</div><div class="pm-value">${escapeHtml(customer.phone)}</div></div><div class="pm-field"><div class="pm-label">البريد الإلكتروني:</div><div class="pm-value">${escapeHtml(customer.email || "-")}</div></div>` : ""}
    ${so.delivery_address ? `<div class="pm-field pm-field-wide"><div class="pm-label">عنوان التسليم:</div><div class="pm-value">${escapeHtml(so.delivery_address)}</div></div>` : ""}
    ${so.delivery_contact_name ? `<div class="pm-field"><div class="pm-label">مسؤول الاستلام:</div><div class="pm-value">${escapeHtml(so.delivery_contact_name)}</div></div><div class="pm-field"><div class="pm-label">هاتف الاستلام:</div><div class="pm-value">${escapeHtml(so.delivery_contact_phone || "-")}</div></div>` : ""}
  </div></div>

  <table class="pm-table">
    <thead>
      <tr>${
        withStatus
          ? `
        <th class="pm-center" style="width: 5%;">م</th>
        <th style="width: 27%;">البيان</th>
        <th class="pm-center" style="width: 7%;">الكمية</th>
        <th class="pm-center" style="width: 8%;">المُسلَّم</th>
        <th class="pm-center" style="width: 8%;">المتبقي</th>
        <th class="pm-center" style="width: 11%;">الحالة</th>
        <th class="pm-num" style="width: 16%;">سعر الوحدة (جنيه)</th>
        <th class="pm-num" style="width: 18%;">القيمة (جنيه)</th>`
          : `
        <th class="pm-center" style="width: 6%;">م</th>
        <th style="width: 38%;">البيان</th>
        <th class="pm-center" style="width: 8%;">${deliveredOnly ? "الكمية المُسلَّمة" : "الكمية"}</th>
        <th class="pm-num" style="width: 24%;">سعر الوحدة (جنيه)</th>
        <th class="pm-num" style="width: 24%;">القيمة (جنيه)</th>`
      }
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
${renderSoTotalsBlock(totals)}

  ${deliveredValueBox}${permitsBox}<div class="pm-note"><strong>طريقة الدفع:</strong> ${escapeHtml(PAYMENT_AR[type] || type)}${details.length ? `<div style="margin-top:6px;font-size:10pt;">${details.join(" &nbsp;|&nbsp; ")}</div>` : ""}</div>
  ${so.notes ? `<div class="pm-note"><strong>ملاحظات إضافية:</strong><br/><span style="font-size: 10pt;">${escapeHtml(so.notes)}</span></div>` : ""}

  <div class="pm-signatures">
    <div class="pm-sign"><div class="signature-label">توقيع العميل</div><div class="pm-sign-line"></div></div>
    <div class="pm-sign"><div class="signature-label">التوقيع المعتمد</div><div class="pm-sign-line"></div></div>
  </div>
${PRINT_ROWS_SCRIPT}
</body>
</html>`
}
