// Small HTML helpers shared by the print builders (Batch 3). Pure functions, safe to import from the browser and
// from route handlers.
import type { PrintTotals, SoPrintTotals } from "./print-totals"
import { round2 } from "./print-totals"
import { escapeHtml } from "./html-escape"

export { escapeHtml }

/** Egyptian paper layout splits money into pounds (جنيه) and piastres (قرش) columns. Exact: derived from cents. */
export function splitMoney(amount: number): { pounds: string; piastres: string; negative: boolean } {
  const cents = Math.round(Math.abs(round2(amount)) * 100)
  return {
    pounds: Math.floor(cents / 100).toLocaleString("en-US"),
    piastres: String(cents % 100).padStart(2, "0"),
    negative: amount < 0 && cents > 0,
  }
}

/**
 * One money figure for print: whole pounds print without decimals ("5,750"), anything with piastres keeps exactly two
 * ("2,943.33"). Rounded to the piastre first, so nothing is lost or invented.
 */
export function formatMoney(amount: number): string {
  const cents = Math.round(Math.abs(round2(amount)) * 100)
  const whole = cents % 100 === 0
  const text = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  return (amount < 0 && cents > 0 ? "-" : "") + text
}

/** One money cell for a table row (printables show money in a single column, no piastre column). */
export function moneyCell(amount: number, style = ""): string {
  return `<td class="currency-col"${style ? ` style="${style}"` : ""}>${formatMoney(amount)}</td>`
}

/** Two currency cells (pounds, piastres) for a table row. Kept for callers outside the printables. */
export function moneyCells(amount: number, style = ""): string {
  const { pounds, piastres, negative } = splitMoney(amount)
  const s = style ? ` style="${style}"` : ""
  return `<td class="currency-col"${s}>${negative ? "-" : ""}${pounds}</td><td class="currency-col"${s}>${piastres}</td>`
}

/** CSS that every totals block needs: keeps the block in one piece and lets the item table break between rows. */
export const TOTALS_BLOCK_CSS = `
    .items-table thead { display: table-header-group; }
    .items-table tr { break-inside: avoid; page-break-inside: avoid; }
    .totals-block { width: 60%; margin-right: 0; margin-left: auto; break-inside: avoid; page-break-inside: avoid; border: 2px solid #000; }
    .totals-block td { border: 1px solid #000; padding: 6px 8px; }
    .totals-block .label { text-align: right; }
    .totals-block .currency-col { text-align: center; width: 40%; }`

interface TotalsRow {
  label: string
  amount: number
  style?: string
}

function totalsTable(rows: TotalsRow[]): string {
  return `
  <table class="totals-block">
    <tbody>${rows
      .map((r) => `
      <tr><td class="label" style="${r.style || ""}">${escapeHtml(r.label)}</td>${moneyCell(r.amount, r.style)}</tr>`)
      .join("")}
    </tbody>
  </table>`
}

/**
 * The totals / VAT section of a quotation or sales order. It is a separate table AFTER the item table (never a
 * <tfoot>, which browsers repeat on every printed page) and is kept in one piece, so it prints once, on the last page.
 */
export function renderTotalsBlock(totals: PrintTotals, labels: { subtotal?: string; discount?: string; netSubtotal?: string; vat?: string; total?: string } = {}): string {
  const rows: TotalsRow[] = []
  if (totals.discount > 0) {
    rows.push({ label: labels.subtotal || "المجموع قبل الخصم", amount: totals.subtotal })
    rows.push({ label: labels.discount || "الخصم", amount: -totals.discount, style: "color: red;" })
  }
  rows.push({ label: labels.netSubtotal || (totals.discount > 0 ? "المجموع بعد الخصم" : "المجموع الفرعي"), amount: totals.netSubtotal })
  rows.push({ label: labels.vat || "ضريبة القيمة المضافة (14%)", amount: totals.vat })
  rows.push({ label: labels.total || "الإجمالي", amount: totals.total, style: "font-weight: 700;" })
  return totalsTable(rows)
}

/** Sales-order version: adds the Original total / returns adjustment / current net total lines when goods were returned. */
export function renderSoTotalsBlock(t: SoPrintTotals): string {
  const rows: TotalsRow[] = []
  if (t.breakdownConsistent) {
    if (t.discount > 0) {
      rows.push({ label: "المجموع قبل الخصم", amount: t.subtotal })
      rows.push({ label: "الخصم", amount: -t.discount, style: "color: red;" })
    }
    rows.push({ label: t.discount > 0 ? "المجموع بعد الخصم" : "المجموع الفرعي", amount: t.netSubtotal })
    rows.push({ label: "ضريبة القيمة المضافة (14%)", amount: t.vat })
  }
  const returned = Math.abs(t.returnsAdjustment) > 0.005
  rows.push({ label: returned ? "الإجمالي الأصلي" : "الإجمالي", amount: t.originalTotal, style: "font-weight: 700;" })
  if (returned) {
    rows.push({ label: "مرتجعات / تسويات", amount: t.returnsAdjustment, style: "color: red;" })
    rows.push({ label: "صافي الإجمالي الحالي", amount: t.currentNetTotal, style: "font-weight: 700;" })
  }
  return totalsTable(rows)
}
