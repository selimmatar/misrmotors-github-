// What approving a sales order sets off, for the new quotation workflow where the sales rep's conversion approves the
// order (lib/workflow-switch.ts). The stock hold, delivery permits, revenue figures and the PO screen all follow from
// the status alone; the one thing the accountant's approval (PUT /api/sales-orders, status "accountant_approved")
// also wrote is the down-payment invoice of a hybrid order, `INV-<so_number>-DP`, created here the same way.
// The other invoice that PUT tries to insert has no customer or amount and never succeeds, so it is not repeated.

type Db = any // supabase-js client (or a test double)

export async function runApprovalSideEffects(db: Db, so: any): Promise<void> {
  const downPaymentAmount = Number(so.down_payment_amount) || 0
  if (so.payment_type !== "hybrid" || downPaymentAmount <= 0) return

  const invoiceNumber = `INV-${so.so_number}-DP`
  const { data: existing } = await db.from("accounts_receivable").select("invoice_id").eq("invoice_number", invoiceNumber).limit(1)
  if (existing && existing.length > 0) return

  const today = new Date().toISOString().split("T")[0]
  const { error } = await db.from("accounts_receivable").insert({
    invoice_number: invoiceNumber,
    customer_id: so.customer_id,
    so_id: so.so_id,
    invoice_date: today,
    due_date: today,
    amount: downPaymentAmount,
    collected_amount: 0,
    status: "pending",
    installment_months: 1,
    months_paid: 0,
    payment_terms: "down_payment",
  })
  if (error) throw new Error(`down payment invoice: ${error.message || error}`)
}
