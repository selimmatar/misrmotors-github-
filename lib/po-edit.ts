// When a purchase order may still be edited (POST /api/purchase-orders/edit; owner request, 2026-11-08).
import { SUPPLIER_CREDIT_PAYMENT_METHOD } from "@/lib/supplier-credit-apply"

/** Statuses in which the PO screen offers Edit. Receiving goods moves a PO out of these. */
export const PO_EDITABLE_STATUSES: readonly string[] = ["draft", "pending", "approved"]

/** Why this PO cannot be edited, or null when it can. Reads receipts and the bill's payments. */
export async function editBlocker(db: any, po: any): Promise<{ code: string; error: string } | null> {
  if (!PO_EDITABLE_STATUSES.includes(String(po.status))) {
    return { code: "PO_NOT_EDITABLE", error: `A "${po.status}" purchase order cannot be edited` }
  }
  if (po.cost_finalized) return { code: "PO_RECEIVED", error: "The cost of this purchase order is already finalized" }
  const { data: receipts, error: receiptsError } = await db.from("goods_receipts").select("receipt_id").eq("po_id", po.po_id).limit(1)
  if (receiptsError) throw receiptsError
  if ((receipts || []).length > 0) {
    return { code: "PO_RECEIVED", error: "Goods were already received on this purchase order, so it can no longer be edited" }
  }
  const { data: bills, error: billsError } = await db.from("accounts_payable").select("*").eq("po_id", po.po_id)
  if (billsError) throw billsError
  for (const bill of bills || []) {
    const { data: payments, error: paymentsError } = await db.from("supplier_payments").select("payment_id, payment_method").eq("invoice_id", bill.invoice_id)
    if (paymentsError) throw paymentsError
    const { data: schedules, error: schedulesError } = await db
      .from("payment_schedules")
      .select("schedule_id, paid_amount, status")
      .eq("invoice_id", bill.invoice_id)
    if (schedulesError) throw schedulesError
    const paid =
      (payments || []).some((p: any) => p.payment_method !== SUPPLIER_CREDIT_PAYMENT_METHOD) ||
      (Number(bill.months_paid) || 0) > 0 ||
      (schedules || []).some((s: any) => (Number(s.paid_amount) || 0) > 0 || s.status === "paid" || s.status === "partial")
    if (paid) return { code: "PO_PAID", error: "A payment is already recorded on this purchase order's supplier bill, so it can no longer be edited" }
  }
  return null
}
