// The supplier bill (accounts_payable row) of a purchase order (owner request, 2026-11-11).
//
// A PO is "open" (work in progress) until someone closes it: it can be edited, exchanged, returned against and paid an
// advance on, and it has NO supplier bill. "Close PO & send to Accounts Payable" makes the bill from the final PO;
// "Reopen PO" removes it again while nothing has been paid on it. A PO with a bill is "closed".
//
// Supplier credits reserved on the PO (credits from returns picked when the PO was made, and advances paid on the open
// PO) settle part of the bill when it is made: each becomes a supplier_payments row with a reference number that marks
// it as made by the close, so a reopen can take it off again. They are not cash movements at close: an advance wrote its
// cash entry when it was paid, a return credit never moves cash.
import { SUPPLIER_CREDIT_PAYMENT_METHOD, creditedInvoiceFields } from "./supplier-credit-apply"

type Db = any

export const ADVANCE_CREDIT_TYPE = "advance"
export { PO_CLOSE_ROLES, PO_CLOSABLE_STATUSES } from "./po-edit"

const today = () => new Date().toISOString().split("T")[0]
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Payment rows the close itself wrote (credits / advances taken off the bill): they are not payments made later. */
export const isClosePayment = (payment: { reference_number?: string | null }, invoiceNumber: string) => {
  const ref = String(payment.reference_number || "")
  return ref === `${invoiceNumber}-CREDIT` || ref.startsWith(`${invoiceNumber}-ADV-`) || ref.startsWith(`${invoiceNumber}-CR-`)
}

/** The method an advance was paid with, kept in its notes ("method=cash; ..."). */
export const advanceMethod = (credit: { notes?: string | null }) => /method=([a-z_]+)/.exec(String(credit.notes || ""))?.[1] || "cash"

export async function billsOf(db: Db, poId: number): Promise<any[]> {
  const { data, error } = await db.from("accounts_payable").select("*").eq("po_id", poId)
  if (error) throw new Error(`read supplier bill: ${error.message}`)
  return data || []
}

/** True when money has been paid on any bill of the PO (not counting what the close itself took off). */
export async function billHasPayments(db: Db, bills: any[]): Promise<boolean> {
  for (const bill of bills) {
    if ((Number(bill.months_paid) || 0) > 0) return true
    const { data: payments, error } = await db.from("supplier_payments").select("payment_id, reference_number, payment_method").eq("invoice_id", bill.invoice_id)
    if (error) throw new Error(`read supplier payments: ${error.message}`)
    // anything the close did not write counts as paid, a credit applied by hand from Accounts Payable included
    if ((payments || []).some((p: any) => !isClosePayment(p, bill.invoice_number))) return true
    const { data: schedules, error: schedulesError } = await db.from("payment_schedules").select("schedule_id, paid_amount, status").eq("invoice_id", bill.invoice_id)
    if (schedulesError) throw new Error(`read payment schedule: ${schedulesError.message}`)
    if ((schedules || []).some((s: any) => (Number(s.paid_amount) || 0) > 0 || s.status === "paid" || s.status === "partial")) return true
  }
  return false
}

/**
 * Makes the supplier bill of a PO unless one exists. Returns the error, or null when the bill exists afterwards.
 * Reserved credits and advances are recorded as paid; if that fails the bill is removed again.
 */
export async function createPoBill(db: Db, po: any): Promise<{ message: string } | null> {
  const { data: existing, error: lookupError } = await db.from("accounts_payable").select("invoice_id").eq("po_id", po.po_id).limit(1)
  if (lookupError) return lookupError
  if (existing && existing.length > 0) return null

  const { data: reserved, error: reservedError } = await db
    .from("supplier_credits")
    .select("credit_id, amount, credit_type, notes, description")
    .eq("used_in_po_id", po.po_id)
    .eq("status", "used")
  if (reservedError) return { message: `Could not read the supplier credits: ${reservedError.message}` }
  const reservedTotal = money((reserved || []).reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0))
  const credited = creditedInvoiceFields(Number(po.total) || 0, reservedTotal)

  const paymentType = po.payment_type || po.payment_terms || "cash"
  const invoiceData: any = {
    invoice_number: `APINV-${po.po_number}`,
    supplier_id: po.supplier_id,
    po_id: po.po_id,
    invoice_date: today(),
    due_date: po.down_payment_due_date || po.payment_start_date || today(),
    amount: po.total,
    paid_amount: credited.paid_amount,
    status: credited.status,
    payment_type: paymentType,
    payment_terms: paymentType,
    installment_months: po.installments || 1,
    months_paid: 0,
    down_payment_amount: po.down_payment_amount || null,
    down_payment_percent: po.down_payment_percent || null,
    down_payment_type: po.down_payment_type || null,
    down_payment_due_date: po.down_payment_due_date || null,
    remaining_amount: po.remaining_amount || null,
    remaining_installment_months: po.remaining_installment_months || null,
    monthly_amount: po.monthly_amount || null,
    payment_start_date: po.payment_start_date || null,
    schedule_entries: po.schedule_entries || null,
    schedule_mode: po.schedule_mode || "AUTO",
  }
  const { data: invoice, error: invoiceError } = await db.from("accounts_payable").insert(invoiceData).select().single()
  if (invoiceError) return invoiceError
  if (credited.paid_amount <= 0) return null

  // What the reserved credits settle, never more than the bill: advances first (real money already paid), then
  // credits from returns. Each is its own payment row so the bill's history shows how it was settled.
  let left = credited.paid_amount
  const rows: any[] = []
  const ordered = [...(reserved || [])].sort((a: any, b: any) => (a.credit_type === ADVANCE_CREDIT_TYPE ? 0 : 1) - (b.credit_type === ADVANCE_CREDIT_TYPE ? 0 : 1))
  const returnCredits = ordered.filter((c: any) => c.credit_type !== ADVANCE_CREDIT_TYPE)
  for (const credit of ordered.filter((c: any) => c.credit_type === ADVANCE_CREDIT_TYPE)) {
    const amount = money(Math.min(Number(credit.amount) || 0, left))
    if (amount <= 0) continue
    left = money(left - amount)
    rows.push({
      invoice_id: invoice.invoice_id,
      supplier_id: po.supplier_id ?? null,
      amount,
      payment_date: today(),
      payment_method: advanceMethod(credit),
      reference_number: `${invoice.invoice_number}-ADV-${credit.credit_id}`,
      receipt_url: null,
      recorded_by: null,
    })
  }
  const creditPart = money(Math.min(left, returnCredits.reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)))
  if (creditPart > 0) {
    rows.push({
      invoice_id: invoice.invoice_id,
      supplier_id: po.supplier_id ?? null,
      amount: creditPart,
      payment_date: today(),
      payment_method: SUPPLIER_CREDIT_PAYMENT_METHOD,
      reference_number: `${invoice.invoice_number}-CREDIT`,
      receipt_url: null,
      recorded_by: null,
    })
  }
  const { error: paymentError } = rows.length > 0 ? await db.from("supplier_payments").insert(rows) : { error: null }
  if (paymentError) {
    await db.from("supplier_payments").delete().eq("invoice_id", invoice.invoice_id)
    const { error: removeError } = await db.from("accounts_payable").delete().eq("invoice_id", invoice.invoice_id)
    if (removeError) console.error("PO bill: could not remove the bill after the credit payments failed", removeError)
    return paymentError
  }
  return null
}

/**
 * Removes the bill(s) of a PO so it is open again. Only what the close wrote goes (the bill, the credit / advance rows
 * it recorded, its unpaid schedule); the credits and advances stay reserved on the PO for the next close.
 * Supplier credits that point at the bill (e.g. returns credited while it was closed) are unlinked first, because the
 * database refuses to delete a bill they point at; their ids are returned so the next close links them again.
 * The caller has checked that nothing was paid. Any failure puts back everything this call already changed.
 */
export async function removePoBills(db: Db, bills: any[]): Promise<{ unlinkedCreditIds: number[] }> {
  const undo: (() => PromiseLike<unknown>)[] = []
  const unlinkedCreditIds: number[] = []
  try {
    for (const bill of bills) {
      const { data: linked, error: linkedError } = await db.from("supplier_credits").select("credit_id").eq("invoice_id", bill.invoice_id)
      if (linkedError) throw new Error(`read linked supplier credits: ${linkedError.message}`)
      const ids = (linked || []).map((c: any) => c.credit_id)
      if (ids.length > 0) {
        const { error: e } = await db.from("supplier_credits").update({ invoice_id: null }).in("credit_id", ids)
        if (e) throw new Error(`unlink supplier credits: ${e.message}`)
        undo.push(() => db.from("supplier_credits").update({ invoice_id: bill.invoice_id }).in("credit_id", ids))
        unlinkedCreditIds.push(...ids)
      }
      const { data: payments, error } = await db.from("supplier_payments").select("*").eq("invoice_id", bill.invoice_id)
      if (error) throw new Error(`read supplier payments: ${error.message}`)
      const own = (payments || []).filter((p: any) => isClosePayment(p, bill.invoice_number))
      if (own.length > 0) {
        const { error: e } = await db.from("supplier_payments").delete().in("payment_id", own.map((p: any) => p.payment_id))
        if (e) throw new Error(`remove credit payments: ${e.message}`)
        undo.push(() => db.from("supplier_payments").insert(own))
      }
      const { data: schedules, error: readScheduleError } = await db.from("payment_schedules").select("*").eq("invoice_id", bill.invoice_id)
      if (readScheduleError) throw new Error(`read payment schedule: ${readScheduleError.message}`)
      if ((schedules || []).length > 0) {
        const { error: scheduleError } = await db.from("payment_schedules").delete().eq("invoice_id", bill.invoice_id)
        if (scheduleError) throw new Error(`remove payment schedule: ${scheduleError.message}`)
        undo.push(() => db.from("payment_schedules").insert(schedules))
      }
      const { error: billError } = await db.from("accounts_payable").delete().eq("invoice_id", bill.invoice_id)
      if (billError) throw new Error(`remove supplier bill: ${billError.message}`)
    }
    return { unlinkedCreditIds }
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (e) {
        console.error("PO bill: could not undo a reopen step", e)
      }
    }
    throw error
  }
}

/** After a close: credits a reopen unlinked from the old bill point at the new one again. */
export async function relinkCredits(db: Db, poId: number, creditIds: number[]): Promise<void> {
  if (creditIds.length === 0) return
  const { data: bill } = await db.from("accounts_payable").select("invoice_id").eq("po_id", poId).limit(1).maybeSingle()
  if (!bill) return
  const { error } = await db.from("supplier_credits").update({ invoice_id: bill.invoice_id }).in("credit_id", creditIds).is("invoice_id", null)
  if (error) console.error("PO bill: could not link the supplier credits to the new bill", error)
}
