// Shared print theme for the printable documents ("Plain modern"): black ink on white, one typeface, hairlines, no fills,
// no rounded boxes, no colour except the logo. Presentation only: the helpers below take trusted, already-escaped HTML
// and emit markup around it; they add no text of their own. This module stands alone (no imports, no Arabic text).

/** The shared stylesheet. One rule per line. Templates put it first in their <style>, then their own small additions. */
export const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4; margin: 15mm; }
html { background: #fff; }
body { font-family: 'IBM Plex Sans Arabic', 'Noto Naskh Arabic', Arial, Tahoma, sans-serif; color: #000; background: #fff; font-size: 13px; line-height: 1.5; }
img { max-inline-size: 100%; }
table { border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.pm-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-block-end: 14px; }
.pm-brand { display: flex; align-items: center; gap: 12px; }
.pm-brand img { block-size: 56px; inline-size: auto; max-inline-size: 140px; object-fit: contain; }
.pm-names { display: block; }
.pm-name-ar { font-size: 17px; font-weight: 700; }
.pm-name-en { font-size: 11px; color: #555; letter-spacing: 0.06em; }
.pm-company { font-size: 11px; color: #555; line-height: 1.7; text-align: end; }
.pm-tax { margin-block-start: 4px; font-size: 11px; color: #555; }
.pm-title { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding-block: 18px 16px; }
.pm-title .doc-title { font-size: 34px; font-weight: 700; line-height: 1.2; }
.pm-title-note { font-size: 13px; font-weight: 600; }
.pm-title-no { font-size: 13px; color: #333; text-align: end; }
.pm-title-no .pm-value { font-size: 15px; font-weight: 600; color: #000; }
.pm-info { margin-block: 14px; }
.pm-info-title { margin-block-end: 6px; font-size: 13px; font-weight: 700; }
.pm-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 16px; border-block-start: 1.5px solid #000; padding-block-start: 10px; }
.pm-field { min-inline-size: 0; }
.pm-field-wide { grid-column: span 2; }
.pm-label { font-size: 11px; font-weight: 400; color: #555; }
.pm-field .pm-label { display: block; }
.pm-value { font-weight: 500; color: #000; overflow-wrap: anywhere; }
.pm-section-title { margin-block: 16px 8px; padding-block-end: 4px; border-block-end: 1px solid #000; font-size: 14px; font-weight: 700; }
.pm-note { margin-block: 12px; font-size: 12px; line-height: 1.6; color: #000; overflow-wrap: anywhere; }
.pm-table { inline-size: 100%; margin-block: 8px 12px; border-collapse: collapse; }
.pm-table th, .pm-table td { border: 0; }
.pm-table th { padding: 6px; font-size: 11px; font-weight: 500; color: #555; text-align: start; background: none; border-block-end: 1.5px solid #000; }
.pm-table td { padding: 7px 6px; vertical-align: top; border-block-end: 1px solid #ccc; overflow-wrap: break-word; }
.pm-table td.pm-num, .pm-table td.currency-col { white-space: nowrap; overflow-wrap: normal; }
.pm-table tfoot td { border-block-end: 0; }
.pm-num, .pm-table .currency-col { text-align: end; font-variant-numeric: tabular-nums; }
.pm-center, .center { text-align: center; }
.pm-table th.pm-num { text-align: end; }
.pm-table th.pm-center { text-align: center; }
.pm-totals { inline-size: 60%; margin-block: 8px; margin-inline: auto 0; break-inside: avoid; page-break-inside: avoid; }
.pm-totals td { padding: 4px 6px; border: 0; }
.pm-total-final, .pm-total-final td { border-block-start: 1.5px solid #000; font-weight: 700; }
body .totals-block tr:has(td[style*="font-weight: 700"]) td { border-block-start: 1.5px solid #000 !important; font-weight: 700; }
body .totals-block, body .totals-block td { border: 0 !important; }
body .totals-block { margin-inline: auto 0; }
body .totals-block td { padding: 4px 6px; }
body .totals-block .label { text-align: start; }
body .totals-block .currency-col { text-align: end; font-variant-numeric: tabular-nums; }
body .totals-block td.currency-col { width: 20%; }
body .totals-block *, .returned, .missing, [class*="status"], [class*="badge"] { color: #000 !important; background: none !important; }
.missing { font-weight: 700; }
[class*="status"], [class*="badge"] { padding: 0 !important; border: 0 !important; font-weight: 600; }
.pm-signatures { display: flex; justify-content: space-between; gap: 48px; margin-block-start: 40px; break-inside: avoid; page-break-inside: avoid; }
.pm-sign { flex: 1; font-size: 11px; color: #333; }
.pm-sign-line { margin-block-start: 6px; border-block-end: 1px solid #000; block-size: 28px; }
.pm-footer { margin-block-start: 16px; font-size: 11px; color: #555; text-align: center; }
@media print { .no-print { display: none !important; } }
`

/** Company header: logo and names on the start side, the company details block on the end side (small, grey). */
export function printHeader(o: {
  logoHtml: string
  company: { nameAr?: string; nameEn?: string; detailsHtml: string }
  taxInfo?: string
}): string {
  const ar = o.company.nameAr !== undefined ? `<div class="pm-name-ar">${o.company.nameAr}</div>` : ""
  const en = o.company.nameEn !== undefined ? `<div class="pm-name-en">${o.company.nameEn}</div>` : ""
  const tax = o.taxInfo !== undefined ? `<div class="pm-tax">${o.taxInfo}</div>` : ""
  return `<header class="pm-header"><div class="pm-brand">${o.logoHtml}<div class="pm-names">${ar}${en}</div></div><div class="pm-company">${o.company.detailsHtml}${tax}</div></header>`
}

/**
 * The document title, large, with its number (and an optional note) in the same row. `titleAr` is the main title in the
 * document's own language. The `doc-title` markup is kept as it is because print tests match it.
 */
export function docTitle(o: { titleAr: string; numberLabel?: string; number?: string; noteHtml?: string }): string {
  const note = o.noteHtml !== undefined ? `<div class="pm-title-note">${o.noteHtml}</div>` : ""
  let no = ""
  if (o.numberLabel !== undefined || o.number !== undefined) {
    const label = o.numberLabel !== undefined ? `<span class="pm-label">${o.numberLabel}</span>` : ""
    const value = o.number !== undefined ? `<span class="pm-value">${o.number}</span>` : ""
    no = `<div class="pm-title-no">${label}${label && value ? " " : ""}${value}</div>`
  }
  return `<div class="pm-title"><div class="doc-title">${o.titleAr}</div>${note}${no}</div>`
}

export type InfoRow = readonly [label: string, value: string, wide?: true] | null | false | undefined

/** A block of labelled fields: small grey labels over their values, one black rule above. Empty rows are skipped. */
export function infoBox(title: string, rows: InfoRow[]): string {
  const head = title ? `<div class="pm-info-title">${title}</div>` : ""
  const fields = rows
    .filter((r): r is readonly [string, string, true?] => Boolean(r))
    .map((r) => `<div class="pm-field${r[2] ? " pm-field-wide" : ""}"><div class="pm-label">${r[0]}</div><div class="pm-value">${r[1]}</div></div>`)
    .join("")
  return `<section class="pm-info">${head}<div class="pm-fields">${fields}</div></section>`
}
