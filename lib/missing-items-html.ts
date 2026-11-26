// HTML for the Missing Items report (Batch 3). Pure: takes the data from lib/missing-items.ts.
import { escapeHtml } from "./print-html"
import type { MissingItemsReport } from "./missing-items"
import { PRINT_CSS, docTitle, PRINT_ROWS_SCRIPT } from "./print/print-theme"

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
    .replace("Taken from stock — No PO Needed", "مأخوذ من المخزون — لا يحتاج أمر شراء")
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

/** The plain "where is it" label of a line (owner request 2026-11-27: a simpler report). The full purchasing detail
 *  (PO numbers, quantities) is printed under it in small text when it adds something. */
export function nextStep(r: { missing: number; inStock: number; onHold: boolean; procurementStatus: string }): { label: string; tone: "ok" | "wait" | "act" } {
  const s = r.procurementStatus
  if (r.missing <= 0 && r.inStock > 0) return { label: r.onHold ? "محجوز في المخزن" : "جاهز في المخزن", tone: "ok" }
  if (/Needs PO|Needs Reorder/.test(s)) return { label: s.startsWith("Rejected") ? "أمر الشراء مرفوض — يحتاج إعادة طلب" : "يحتاج أمر شراء", tone: "act" }
  if (s.startsWith("Ordered") || s.startsWith("Partially")) return { label: "مطلوب من المورد", tone: "wait" }
  return { label: "من المخزن — لا يحتاج أمر شراء", tone: "ok" }
}
const PLAIN_STATUS = new Set(["Not Ordered — Needs PO", "In Stock — No PO Needed", "On Hold — In Stock", "Stock Item — No PO Needed", "Taken from stock — No PO Needed"])

/** `hideCost` removes the Unit Cost column and the total value that depends on it. Nothing else changes. */
export function renderMissingItemsHtml(report: MissingItemsReport, opts: { hideCost: boolean; generatedAt: string }): string {
  const { so, rows } = report
  // every line still to deliver: truly missing, or covered by stock in our warehouse (Missing 0, ready in stock)
  const missing = rows.filter((r) => r.missing > 0 || r.inStock > 0)
  const hideCost = opts.hideCost
  // value of what is still missing, from the items that HAVE a cost; items without one are counted, never priced
  const costed = missing.filter((r) => r.missing > 0 && r.unitCost !== null)
  const totalValue = costed.reduce((s, r) => s + r.missing * (r.unitCost as number), 0)
  const uncosted = missing.filter((r) => r.missing > 0).length - costed.length
  const atPoPrice = costed.filter((r) => r.costSource === "po_price").length
  const steps = missing.map(nextStep)
  const totalMissing = missing.reduce((s, r) => s + r.missing, 0)
  const needPo = steps.filter((x) => x.tone === "act").length
  const ready = missing.filter((r) => r.missing <= 0 && r.inStock > 0).length

  const body = missing
    .map((r, i) => {
      const step = steps[i]
      const sub = [r.sku !== "-" ? `الكود: ${escapeHtml(r.sku)}` : "", r.supplierName && r.supplierName !== "-" ? `المورد: ${escapeHtml(r.supplierName)}` : ""].filter(Boolean).join(" · ")
      const detail = [
        PLAIN_STATUS.has(r.procurementStatus) ? "" : escapeHtml(procurementAr(r.procurementStatus)),
        r.inProgress > 0 ? `${r.inProgress} على إذن تسليم لم يخرج بعد` : "",
      ].filter(Boolean).join("<br>")
      return `
        <tr>
          <td class="n">${i + 1}</td>
          <td class="item">${escapeHtml(r.name)}${r.isOutsourced ? ' <span class="type-tag">خارجي</span>' : ""}${sub ? `<div class="sku">${sub}</div>` : ""}</td>
          <td class="n">${r.ordered}</td>
          <td class="n">${r.netDelivered}${r.returned > 0 ? `<div class="sku">مرتجع ${r.returned}</div>` : ""}</td>
          <td class="n">${r.outForDelivery || "-"}</td>
          <td class="n missing">${r.missing}</td>
          <td><span class="step step-${step.tone}">${step.label}</span>${detail ? `<div class="sku">${detail}</div>` : ""}</td>
          ${hideCost ? "" : `<td class="mi-cost">${r.unitCost === null ? "غير متاح" : money(r.unitCost)}${r.costSource === "po_price" ? '<div class="sku">سعر أمر الشراء</div>' : ""}</td>`}
        </tr>`
    })
    .join("")

  const box = (value: string | number, label: string, cls = "") => `<div class="mi-box ${cls}"><div class="v">${value}</div><div class="l">${label}</div></div>`

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>الأصناف الناقصة — ${escapeHtml(so.so_number)}</title>
  <style>
    ${PRINT_CSS}
    @page { size: A4; margin: 12mm; }
    .container { max-width: 900px; margin: 0 auto; }
    .mi-sub { font-size: 13px; color: #555; }
    .mi-generated { font-size: 11px; color: #555; }
    .mi-cost { white-space: nowrap; }
    .pm-fields .pm-label { display: inline; }
    .mi-boxes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-block: 14px; break-inside: avoid; }
    .mi-box { border: 1px solid #999; padding: 8px; text-align: center; }
    .mi-box .v { font-size: 22px; font-weight: 700; line-height: 1.2; }
    .mi-box .l { font-size: 11px; color: #555; }
    .mi-box.act .v { color: #b91c1c; }
    .mi-box.ok .v { color: #15803d; }
    .pm-table { font-size: 12px; }
    .pm-table th.n, .pm-table td.n { text-align: center; white-space: nowrap; }
    .pm-table td.item { text-align: start; }
    .pm-table td.missing { font-weight: 700; font-size: 14px; }
    .sku { color: #555; font-size: 10px; margin-block-start: 2px; }
    .type-tag { font-size: 10px; border: 1px solid #999; padding: 0 4px; }
    .step { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 6px; border: 1px solid; }
    .step-act { color: #b91c1c; border-color: #b91c1c; }
    .step-wait { color: #1d4ed8; border-color: #1d4ed8; }
    .step-ok { color: #15803d; border-color: #15803d; }
    .totals { text-align: end; font-size: 13px; margin-block: 12px; break-inside: avoid; }
    .totals .value { font-weight: 700; font-size: 16px; }
    .note { font-size: 11px; color: #555; }
    .legend { font-size: 11px; color: #555; margin-block: 8px; }
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
    <div class="mi-sub">ما لم يُسلَّم بعد للعميل من أمر البيع، وأين وصل كل صنف</div>
    <div class="pm-info">
      <div class="pm-fields">
        <div class="pm-field"><span class="pm-label">رقم أمر البيع:</span> <span class="pm-value">${escapeHtml(so.so_number)}</span></div>
        <div class="pm-field"><span class="pm-label">العميل:</span> <span class="pm-value">${escapeHtml(so.customerName)}</span></div>
        <div class="pm-field"><span class="pm-label">تاريخ الأمر:</span> <span class="pm-value">${date(so.order_date)}</span></div>
        <div class="pm-field"><span class="pm-label">تاريخ التسليم:</span> <span class="pm-value">${date(so.delivery_date)}</span></div>
        <div class="pm-field"><span class="pm-label">حالة الأمر:</span> <span class="pm-value">${escapeHtml(statusAr(so.status))}</span></div>
      </div>
    </div>
    ${
      missing.length === 0
        ? `<div class="empty-state">✅ لا توجد أصناف ناقصة — تم تسليم كل أصناف هذا الأمر.</div>`
        : `
    <div class="mi-boxes">
      ${box(missing.length, "أصناف لم تُسلَّم")}
      ${box(totalMissing, "إجمالي الكمية الناقصة")}
      ${box(needPo, "تحتاج أمر شراء", needPo > 0 ? "act" : "")}
      ${box(ready, "جاهزة في المخزن", ready > 0 ? "ok" : "")}
    </div>
    <table class="pm-table">
      <thead>
        <tr>
          <th class="n">#</th><th>الصنف</th><th class="n">المطلوب</th><th class="n">تم تسليمه</th><th class="n">في الطريق</th><th class="n">الناقص</th><th>الموقف</th>
          ${hideCost ? "" : "<th>تكلفة الوحدة</th>"}
        </tr>
      </thead>
      <tbody>${body}
      </tbody>
    </table>
    <div class="legend">الناقص = المطلوب − تم تسليمه − في الطريق. «جاهز في المخزن» يعني أن الكمية متوفرة لدينا وتنتظر إذن تسليم.</div>
    ${
      hideCost
        ? ""
        : `<div class="totals">إجمالي تكلفة الأصناف الناقصة: <span class="value">${money(totalValue)}</span>${atPoPrice > 0 ? `<div class="note">${atPoPrice} صنف محسوب بسعر أمر الشراء (سعر المورد، وليس التكلفة الفعلية)</div>` : ""}${uncosted > 0 ? `<div class="note">${uncosted} صنف بدون تكلفة غير محسوب</div>` : ""}</div>`
    }`
    }
    <div class="mi-generated">تاريخ الإصدار: ${escapeHtml(opts.generatedAt)}</div>
  </div>
${PRINT_ROWS_SCRIPT}
</body>
</html>`
}
