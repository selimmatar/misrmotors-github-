import { createAdminClient } from "@/lib/supabase/admin"
import { minvNumber } from "@/lib/maintenance-booklets"

// Printable carbon booklet (spec 2026-11-19, Part 3): one A5 page per MINV number. Prices are written before VAT, and
// the bottom rows hold subtotal, +14% VAT and total, as the worker writes them today.
export const dynamic = "force-dynamic"

const LINE_ROWS = 8

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)

const settingText = (value: unknown) => {
  const text = String(value ?? "").trim()
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "string" ? parsed : text
  } catch {
    return text
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id)
  if (!Number.isInteger(id) || id <= 0) return new Response("Booklet not found", { status: 404 })
  const db = createAdminClient()
  const { data: booklet } = await db
    .from("maintenance_booklets")
    .select("year2, first_serial, last_serial, link:maintenance_upload_links(worker_name)")
    .eq("id", id)
    .maybeSingle()
  if (!booklet) return new Response("Booklet not found", { status: 404 })

  const { data: settings } = await db
    .from("company_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["company_name", "eta_registered_name", "eta_rin"])
  const setting = (key: string) => settingText(settings?.find((s: any) => s.setting_key === key)?.setting_value)
  const company = escapeHtml(setting("eta_registered_name") || setting("company_name") || "Misr Motors")
  const taxId = escapeHtml(setting("eta_rin"))
  const worker = escapeHtml(String((booklet as any).link?.worker_name || ""))

  const rows = Array.from({ length: LINE_ROWS }, () => "<tr><td></td><td></td><td></td><td></td></tr>").join("")
  const pages: string[] = []
  for (let serial = booklet.first_serial; serial <= booklet.last_serial; serial++) {
    pages.push(`<section class="page">
  <header>
    <div><strong>${company}</strong>${taxId ? `<br><span class="small">Tax ID / رقم التسجيل: ${taxId}</span>` : ""}</div>
    <div class="number">${minvNumber(booklet.year2, serial)}</div>
  </header>
  <h1>فاتورة صيانة · Maintenance invoice</h1>
  <div class="fields">
    <div class="field"><span>التاريخ · Date</span></div>
    <div class="field"><span>اسم العميل · Customer</span></div>
    <div class="field"><span>التليفون · Phone</span></div>
  </div>
  <table>
    <thead><tr><th class="wide">البيان · Description</th><th>الكمية · Qty</th><th>السعر قبل الضريبة · Price before VAT</th><th>القيمة · Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><th>الإجمالي قبل الضريبة · Subtotal</th><td></td></tr>
    <tr><th>+ ضريبة القيمة المضافة 14% · VAT 14%</th><td></td></tr>
    <tr class="grand"><th>الإجمالي · Total</th><td></td></tr>
  </table>
  <div class="signs">
    <div>الفني · Technician${worker ? `: ${worker}` : ""}</div>
    <div>توقيع العميل · Customer signature</div>
  </div>
  <footer>نسخة مؤقتة. تصدر الفاتورة الإلكترونية الرسمية بنفس الرقم. · Provisional copy. The official e-invoice follows with the same number.</footer>
</section>`)
  }

  const first = minvNumber(booklet.year2, booklet.first_serial)
  const last = minvNumber(booklet.year2, booklet.last_serial)
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Booklet ${first} – ${last}</title>
<style>
  @page { size: A5; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", Tahoma, sans-serif; color: #111; font-size: 12px; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f3f4f6; border-bottom: 1px solid #d1d5db; font-size: 14px; }
  .toolbar button { min-height: 44px; padding: 0 20px; font-size: 16px; border-radius: 8px; border: 0; background: #111; color: #fff; cursor: pointer; }
  .page { width: 128mm; min-height: 190mm; margin: 12px auto; padding: 4mm; display: flex; flex-direction: column; gap: 4mm; page-break-after: always; break-after: page; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; border-bottom: 2px solid #111; padding-bottom: 3mm; }
  .number { font-size: 22px; font-weight: 700; letter-spacing: 1px; direction: ltr; border: 2px solid #111; padding: 2px 8px; }
  .small { font-size: 10px; }
  h1 { margin: 0; font-size: 15px; text-align: center; }
  .fields { display: flex; flex-direction: column; gap: 3mm; }
  .field { border-bottom: 1px dotted #555; min-height: 8mm; display: flex; align-items: flex-end; }
  .field span { font-size: 11px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #111; padding: 2mm; font-size: 10px; text-align: center; }
  td { height: 9mm; }
  th.wide { width: 46%; }
  .totals { width: 70%; margin-inline-start: auto; }
  .totals th { text-align: start; width: 65%; }
  .totals .grand th, .totals .grand td { font-size: 12px; font-weight: 700; }
  .signs { display: flex; justify-content: space-between; gap: 8mm; margin-top: auto; padding-top: 8mm; }
  .signs div { flex: 1; border-top: 1px solid #111; padding-top: 1mm; font-size: 10px; }
  footer { font-size: 9px; text-align: center; color: #333; }
  @media print { .toolbar { display: none; } .page { margin: 0; } }
</style>
</head>
<body>
<div class="toolbar"><span>${first} – ${last} · ${pages.length} pages</span><button onclick="window.print()">Print · طباعة</button></div>
${pages.join("\n")}
</body>
</html>`
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}
