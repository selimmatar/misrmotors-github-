// Sales order print (Batch 3): Arabic RTL A4 HTML built from saved data. Pure; used by GET /api/sales-orders/print.
import { escapeHtml, moneyCells, renderSoTotalsBlock, TOTALS_BLOCK_CSS } from "./print-html"
import { computeSoPrintTotals } from "./print-totals"

export interface SoPrintData {
  so: Record<string, any>
  customer: { customer_name?: string; phone?: string; email?: string } | null
  items: { name: string; quantity: number; unit_price: number; total: number; returned: number }[]
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
  accountant_approved: "معتمد من المحاسب",
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
  const { so, customer, items } = data
  const subtotal = items.reduce((s, i) => s + n(i.total), 0)
  const totals = computeSoPrintTotals({
    subtotal,
    discountType: so.discount_type,
    discountValue: n(so.discount_value),
    discountAmount: n(so.discount_amount),
    storedTotal: n(so.total),
    storedNetTotal: so.net_total === null || so.net_total === undefined ? null : n(so.net_total),
  })

  const rows = items
    .map(
      (item, idx) => `
      <tr>
        <td class="center">${idx + 1}</td>
        <td>${escapeHtml(item.name)}${item.returned > 0 ? `<div class="returned">مرتجع: ${item.returned}</div>` : ""}</td>
        <td class="center">${n(item.quantity)}</td>
        ${moneyCells(n(item.unit_price))}
        ${moneyCells(n(item.total))}
      </tr>`,
    )
    .join("")

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
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4; margin: 15mm; }
    body { font-family: 'Noto Naskh Arabic', 'Arial', sans-serif; font-size: 12pt; line-height: 1.4; color: #000; background: white; direction: rtl; }
    table { width: 100%; border-collapse: collapse; border: 2px solid #000; }
    th, td { border: 1px solid #000; padding: 8px; text-align: right; }
    th { background: #e8e8e8; font-weight: 700; }
    .company-header { text-align: center; border-bottom: 2px solid #000; padding: 10px; margin-bottom: 5mm; display: flex; flex-direction: column; align-items: center; }
    .company-logo { width: 80px; height: 80px; object-fit: contain; margin-bottom: 10px; }
    .company-name-ar { font-size: 18pt; font-weight: 700; margin-bottom: 3px; }
    .company-name-en { font-size: 14pt; font-weight: 600; margin-bottom: 8px; }
    .company-details { font-size: 10pt; line-height: 1.6; }
    .tax-info { font-size: 9pt; margin-top: 5px; border-top: 1px solid #ccc; padding-top: 5px; }
    .doc-title { text-align: center; font-size: 20pt; font-weight: 700; margin: 8mm 0; text-decoration: underline; }
    .header-table { margin-bottom: 8mm; }
    .header-table td { padding: 4px 8px; }
    .items-table { margin-bottom: 6mm; }
    .items-table th { text-align: center; padding: 8px 4px; }
    .items-table td { padding: 6px 4px; }
    .items-table .center, .currency-col { text-align: center; }
    .subheader { font-size: 10pt; font-weight: 600; }
    .returned { font-size: 9pt; color: #b91c1c; }
    .box { margin-top: 8mm; border: 1px solid #000; padding: 8px; break-inside: avoid; page-break-inside: avoid; }
    .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20mm; margin-top: 15mm; break-inside: avoid; page-break-inside: avoid; }
    .signature-box { text-align: center; }
    .signature-label { font-weight: 700; margin-bottom: 20mm; text-decoration: underline; }
    .signature-line { border-top: 1px solid #000; margin-top: 15mm; }
    .print-button { position: fixed; top: 10px; left: 10px; padding: 8px 14px; cursor: pointer; }
    @media print { body { margin: 0; padding: 0; } .no-print { display: none !important; } }${TOTALS_BLOCK_CSS}
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">طباعة</button>
  <div class="company-header">
    <img src="/images/image.png" alt="Misr Motors Logo" class="company-logo" onerror="this.style.display='none'" />
    <div class="company-name-ar">شركة مصر للمحركات</div>
    <div class="company-name-en">Misr Motors Co.</div>
    <div class="company-details">
      <div>العنوان: 212 ش السودان - ميدان لبنان - المهندسين - الجيزة</div>
      <div>تليفون: 02-33039811 | فاكس: 02-33039818</div>
      <div>البريد الإلكتروني: sales@misrmotors.com</div>
    </div>
    <div class="tax-info">بطاقة ضريبية رقم: 2001 | ملف ضريبة: 10-191-343-5 | رقم التسجيل: 455-050-100</div>
  </div>

  <div class="doc-title">أمر بيع</div>

  <table class="header-table">
    <tr>
      <td style="width: 25%;"><strong>رقم أمر البيع:</strong></td><td style="width: 25%;">${escapeHtml(so.so_number)}</td>
      <td style="width: 25%;"><strong>التاريخ:</strong></td><td style="width: 25%;">${dateAr(so.order_date)}</td>
    </tr>
    <tr><td colspan="2"><strong>السادة:</strong> ${escapeHtml(customer?.customer_name || "-")}</td><td><strong>الحالة:</strong></td><td>${escapeHtml(STATUS_AR[so.status] || so.status || "-")}</td></tr>
    ${customer?.phone ? `<tr><td><strong>الهاتف:</strong></td><td>${escapeHtml(customer.phone)}</td><td><strong>البريد الإلكتروني:</strong></td><td>${escapeHtml(customer.email || "-")}</td></tr>` : ""}
    ${so.delivery_address ? `<tr><td><strong>عنوان التسليم:</strong></td><td colspan="3">${escapeHtml(so.delivery_address)}</td></tr>` : ""}
    ${so.delivery_contact_name ? `<tr><td><strong>مسؤول الاستلام:</strong></td><td>${escapeHtml(so.delivery_contact_name)}</td><td><strong>هاتف الاستلام:</strong></td><td>${escapeHtml(so.delivery_contact_phone || "-")}</td></tr>` : ""}
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th rowspan="2" style="width: 6%;">م</th>
        <th rowspan="2" style="width: 38%;">البيان</th>
        <th rowspan="2" style="width: 8%;">الكمية</th>
        <th colspan="2">سعر الوحدة</th>
        <th colspan="2">القيمة</th>
      </tr>
      <tr>
        <th class="subheader" style="width: 12%;">جنيه</th><th class="subheader" style="width: 12%;">قرش</th>
        <th class="subheader" style="width: 12%;">جنيه</th><th class="subheader" style="width: 12%;">قرش</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
${renderSoTotalsBlock(totals)}

  <div class="box"><strong>طريقة الدفع:</strong> ${escapeHtml(PAYMENT_AR[type] || type)}${details.length ? `<div style="margin-top:6px;font-size:10pt;">${details.join(" &nbsp;|&nbsp; ")}</div>` : ""}</div>
  ${so.notes ? `<div class="box"><strong>ملاحظات إضافية:</strong><br/><span style="font-size: 10pt;">${escapeHtml(so.notes)}</span></div>` : ""}

  <div class="signatures">
    <div class="signature-box"><div class="signature-label">توقيع العميل</div><div class="signature-line"></div></div>
    <div class="signature-box"><div class="signature-label">التوقيع المعتمد</div><div class="signature-line"></div></div>
  </div>
</body>
</html>`
}
