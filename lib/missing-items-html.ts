// HTML for the Missing Items report (Batch 3). Pure: takes the data from lib/missing-items.ts.
import { escapeHtml } from "./print-html"
import type { MissingItemsReport } from "./missing-items"
import { PRINT_CSS, docTitle } from "./print/print-theme"

const money = (n: number) => `EGP ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (s: string | null | undefined) => {
  if (!s) return "-"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_AR: Record<string, string> = {
  draft: "مسودة", pending: "قيد الانتظار", pending_approval: "بانتظار الاعتماد", approved: "معتمد", confirmed: "مؤكد",
  in_progress: "قيد التنفيذ", partially_delivered: "تم التسليم جزئياً", delivered: "تم التسليم", completed: "مكتمل",
  received: "تم الاستلام", partially_received: "تم الاستلام جزئياً", sent: "مرسل", ordered: "تم الطلب",
  rejected: "مرفوض", cancelled: "ملغي", on_hold: "معلق", closed: "مغلق", invoiced: "تمت الفوترة",
}
const statusAr = (s: string | null | undefined) => (s ? STATUS_AR[s.toLowerCase()] || s : "-")

/** The procurement status comes from lib/missing-items.ts in English; the printout shows it in Arabic. */
export function procurementAr(status: string): string {
  return status
    .replace(/\(([^,()]+), ([a-z_]+)\)/g, (_m, qty, st) => `(${qty}، ${statusAr(st)})`)
    .replace("Stock Item — No PO Needed", "صنف مخزون — لا يحتاج أمر شراء")
    .replace("In Stock — No PO Needed", "متوفر في المخزن — لا يحتاج أمر شراء")
    .replace("On Hold — In Stock", "محجوز — متوفر في المخزن")
    .replace("Not Ordered — Needs PO", "لم يُطلب — يحتاج أمر شراء")
    .replace("Rejected PO — Needs Reorder", "أمر شراء مرفوض — يحتاج إعادة طلب")
    .replace(/^Partially ordered /, "تم طلب جزء ")
    .replace(/^Ordered /, "تم الطلب ")
    .replace(/^On Hold (\d)/, "محجوز $1")
    .replace(/^In stock (\d)/, "متوفر في المخزن $1")
    .replace(/ — Needs PO for (\d+)/, " — يحتاج أمر شراء لـ $1")
    .replace(/ ⚠ received (\d+) > PO (\d+)/, " ⚠ المستلم $1 أكبر من أمر الشراء $2")
}

/** `hideCost` removes the Unit Cost column and the total value that depends on it. Nothing else changes. */
export function renderMissingItemsHtml(report: MissingItemsReport, opts: { hideCost: boolean; generatedAt: string }): string {
  const { so, rows } = report
  // every line still to deliver: truly missing, or covered by stock in our warehouse (Missing 0, counted under Received)
  const missing = rows.filter((r) => r.missing > 0 || r.inStock > 0)
  const hideCost = opts.hideCost
  // value of what is still missing, from the items that HAVE a cost; items without one are counted, never priced
  const costed = missing.filter((r) => r.missing > 0 && r.unitCost !== null)
  const totalValue = costed.reduce((s, r) => s + r.missing * (r.unitCost as number), 0)
  const uncosted = missing.filter((r) => r.missing > 0).length - costed.length
  const atPoPrice = costed.filter((r) => r.costSource === "po_price").length

  const badge = (status: string) =>
    status.startsWith("Ordered") ? "badge-ordered" : status.startsWith("Partially") ? "badge-partial" : status.startsWith("Rejected") ? "badge-rejected" : status.startsWith("Stock") || status.startsWith("On Hold") || status.startsWith("In Stock") || status.startsWith("In stock") ? "badge-stock" : "badge-needs-po"

  const body = missing
    .map(
      (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.name)}${r.sku !== "-" ? `<div class="sku">الكود: ${escapeHtml(r.sku)}</div>` : ""}</td>
          <td><span class="type-tag ${r.isOutsourced ? "type-outsourced" : "type-stock"}">${r.isOutsourced ? "خارجي" : r.onHold ? "محجوز" : "مخزون"}</span></td>
          <td>${escapeHtml(r.supplierName)}</td>
          ${hideCost ? "" : `<td class="mi-cost">${r.unitCost === null ? "غير متاح" : money(r.unitCost)}${r.costSource === "po_price" ? '<div class="sku">سعر أمر الشراء</div>' : ""}</td>`}
          <td class="n">${r.ordered}</td>
          <td class="n">${r.outForDelivery}</td>
          <td class="n">${r.delivered}</td>
          <td class="n">${r.returned}</td>
          <td class="n">${r.netDelivered}</td>
          <td class="n missing">${r.missing}</td>
          <td class="n">${r.poOrdered}</td>
          <td class="n">${r.received}</td>
          <td><span class="badge ${badge(r.procurementStatus)}">${escapeHtml(procurementAr(r.procurementStatus))}</span>${r.inProgress > 0 ? `<div class="sku">${r.inProgress} على إذن تسليم لم يخرج بعد</div>` : ""}</td>
        </tr>`,
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>الأصناف الناقصة — ${escapeHtml(so.so_number)}</title>
  <style>
    ${PRINT_CSS}
    @page { size: A4 landscape; margin: 12mm; }
    .container { max-width: 1200px; margin: 0 auto; }
    .mi-sub { font-size: 12px; color: #555; }
    .mi-cost { white-space: nowrap; }
    .mi-generated { margin-block-start: 2px; font-size: 11px; color: #555; }
    .pm-fields .pm-label { display: inline; }
    .pm-table { font-size: 11px; }
    .pm-table th.n, .pm-table td.n { text-align: center; }
    .pm-table td.missing { font-weight: 700; }
    .sku { color: #555; font-size: 10px; }
    .badge, .type-tag { font-size: 10px; font-weight: 600; }
    .totals { text-align: end; font-size: 13px; margin-block-end: 12px; break-inside: avoid; }
    .totals .value { font-weight: 700; font-size: 16px; }
    .note { font-size: 11px; color: #555; }
    .legend { font-size: 11px; color: #555; margin-block-end: 16px; }
    .empty-state { text-align: center; padding: 40px; border: 1px solid #ccc; color: #555; }
    .print-button { position: fixed; top: 14px; inset-inline-end: 14px; padding: 10px 18px; background: #1a56db; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; z-index: 1000; }
    @media screen { body { padding: 24px; } }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <div class="container">
    ${docTitle({ titleAr: `تقرير الأصناف الناقصة` })}
    <div class="mi-sub">أصناف أمر البيع التي لم تُسلَّم للعميل بعد</div>
    <div class="mi-generated">تاريخ الإصدار: ${escapeHtml(opts.generatedAt)}</div>
    <div class="pm-info">
      <div class="pm-fields">
        <div class="pm-field"><span class="pm-label">رقم أمر البيع:</span> <span class="pm-value">${escapeHtml(so.so_number)}</span></div>
        <div class="pm-field"><span class="pm-label">العميل:</span> <span class="pm-value">${escapeHtml(so.customerName)}</span></div>
        <div class="pm-field"><span class="pm-label">تاريخ الأمر:</span> <span class="pm-value">${date(so.order_date)}</span></div>
        <div class="pm-field"><span class="pm-label">تاريخ التسليم:</span> <span class="pm-value">${date(so.delivery_date)}</span></div>
        <div class="pm-field"><span class="pm-label">حالة الأمر:</span> <span class="pm-value">${escapeHtml(statusAr(so.status))}</span></div>
        <div class="pm-field"><span class="pm-label">أذون التسليم الصادرة:</span> <span class="pm-value">${report.permitCount}</span></div>
      </div>
    </div>
    ${
      missing.length === 0
        ? `<div class="empty-state">✅ لا توجد أصناف ناقصة — تم تسليم كل أصناف هذا الأمر.</div>`
        : `
    <div class="legend">المطلوب = كمية أمر البيع · خرج للتسليم = على أذون تسليم خرجت حالياً · المُسلَّم = على أذون مُسلَّمة أو معتمدة · المرتجع = مرتجعات مقبولة · الصافي = المُسلَّم − المرتجع · الناقص = المطلوب − الصافي − خرج للتسليم · في أوامر الشراء = أوامر شراء سارية · المستلم = استلام بضاعة، أو مخزون موجود في مخزننا</div>
    <table class="pm-table">
      <thead>
        <tr>
          <th>#</th><th style="width:20%">الصنف</th><th>النوع</th><th>المورد</th>
          ${hideCost ? "" : "<th>تكلفة الوحدة</th>"}
          <th class="n">المطلوب</th><th class="n">خرج للتسليم</th><th class="n">المُسلَّم</th><th class="n">المرتجع</th><th class="n">صافي المُسلَّم</th><th class="n">الناقص</th><th class="n">في أوامر الشراء</th><th class="n">المستلم</th><th style="width:20%">الشراء</th>
        </tr>
      </thead>
      <tbody>${body}
      </tbody>
    </table>
    ${
      hideCost
        ? ""
        : `<div class="totals">إجمالي تكلفة الأصناف الناقصة: <span class="value">${money(totalValue)}</span>${atPoPrice > 0 ? `<div class="note">${atPoPrice} صنف محسوب بسعر أمر الشراء (سعر المورد، وليس التكلفة الفعلية)</div>` : ""}${uncosted > 0 ? `<div class="note">${uncosted} صنف بدون تكلفة غير محسوب</div>` : ""}</div>`
    }`
    }
  </div>
</body>
</html>`
}
