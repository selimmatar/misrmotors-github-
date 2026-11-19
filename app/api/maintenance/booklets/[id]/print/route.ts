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

const COMPANY_NAME_AR = "شركة مصر للمحركات"

// Embedded as a data URL so the logo still prints when the page is saved as PDF for the print shop.
async function loadLogo(origin: string) {
  try {
    const res = await fetch(`${origin}/images/image.png`)
    if (!res.ok) return ""
    return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`
  } catch {
    return ""
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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
    .in("setting_key", ["eta_rin"])
  const setting = (key: string) => settingText(settings?.find((s: any) => s.setting_key === key)?.setting_value)
  const taxId = escapeHtml(setting("eta_rin"))
  const worker = escapeHtml(String((booklet as any).link?.worker_name || ""))
  const logo = await loadLogo(new URL(request.url).origin)

  const rows = Array.from({ length: LINE_ROWS }, () => "<tr><td></td><td></td><td></td><td></td></tr>").join("")
  const pages: string[] = []
  for (let serial = booklet.first_serial; serial <= booklet.last_serial; serial++) {
    pages.push(`<section class="page">
  <header>
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="${COMPANY_NAME_AR}" class="logo">` : ""}
      <div>
        <div class="name">${COMPANY_NAME_AR}</div>
        ${taxId ? `<div class="small">رقم التسجيل الضريبي ${taxId}</div>` : ""}
        <div class="title">فاتورة صيانة</div>
      </div>
    </div>
    <div class="number">${minvNumber(booklet.year2, serial)}</div>
  </header>
  <div class="fields">
    <div class="field"><span>اسم العميل</span></div>
    <div class="row">
      <div class="field"><span>التاريخ</span></div>
      <div class="field"><span>التليفون</span></div>
    </div>
  </div>
  <table>
    <thead><tr><th class="wide">البيان</th><th class="qty">الكمية</th><th class="money">السعر قبل الضريبة</th><th class="money">القيمة</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><th>الإجمالي قبل الضريبة</th><td></td></tr>
    <tr><th>ضريبة القيمة المضافة ١٤٪؜</th><td></td></tr>
    <tr class="grand"><th>الإجمالي</th><td></td></tr>
  </table>
  <div class="signs">
    <div>الفني${worker ? `: ${worker}` : ""}</div>
    <div>توقيع العميل</div>
  </div>
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
  .page { width: 128mm; min-height: 190mm; margin: 12px auto; padding: 3mm; display: flex; flex-direction: column; gap: 2.5mm; page-break-after: always; break-after: page; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 2px solid #111; padding-bottom: 2.5mm; }
  .brand { display: flex; align-items: center; gap: 3mm; }
  .logo { width: 17mm; height: 17mm; object-fit: contain; }
  .name { font-size: 17px; font-weight: 700; }
  .title { font-size: 12px; font-weight: 700; margin-top: 1mm; }
  .number { font-size: 20px; font-weight: 700; letter-spacing: 1px; direction: ltr; border: 2px solid #111; padding: 2px 8px; white-space: nowrap; }
  .small { font-size: 9.5px; color: #333; }
  .fields { display: flex; flex-direction: column; gap: 2mm; }
  .fields .row { display: flex; gap: 6mm; }
  .fields .row .field { flex: 1; }
  .field { border-bottom: 1px dotted #555; min-height: 8mm; display: flex; align-items: flex-end; }
  .field span { font-size: 11px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #111; padding: 1.5mm; font-size: 9.5px; text-align: center; }
  td { height: 11mm; }
  th.wide { width: 58%; font-size: 11px; }
  th.qty { width: 10%; }
  th.money { width: 16%; }
  .totals { width: 62%; margin-inline-start: auto; }
  .totals th { text-align: start; width: 62%; }
  .totals td { height: 7mm; }
  .totals .grand th, .totals .grand td { font-size: 12px; font-weight: 700; }
  .signs { display: flex; justify-content: space-between; gap: 8mm; margin-top: auto; padding-top: 6mm; }
  .signs div { flex: 1; border-top: 1px solid #111; padding-top: 1mm; font-size: 10px; }
  footer { font-size: 9px; text-align: center; color: #333; }
  @media print { .toolbar { display: none; } .page { margin: 0; } }
</style>
</head>
<body>
<div class="toolbar"><span>${first} – ${last} · ${pages.length} صفحة</span><button onclick="window.print()">طباعة</button></div>
${pages.join("\n")}
</body>
</html>`
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}
