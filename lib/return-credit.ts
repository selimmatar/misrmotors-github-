// A customer return of goods that were ALREADY INVOICED becomes a customer credit (customer_credits, credit_type
// "sales_return"), raised once when the warehouse receives the return. The accountant applies it to the open invoice
// from Accounts Receivable ("apply credit", lib/customer-credit-apply.ts), which lowers what the customer owes.
// Invoices themselves are never rewritten, and returns received before this change are never credited.
//
// Amount = the value of THIS return (order price with discount and VAT), capped by what the invoices already billed
// for units the customer no longer keeps (per item, see overBilledValue), less the return credits the order already
// has. Example: 4 pumps invoiced at 228,000; 1 returned -> 57,000 credit. A gun invoiced on its own delivery permit
// and returned is credited even while other items are still to be delivered. A return the later invoices can still
// leave out (the same item is still to be delivered and invoiced) gives no credit: those invoices bill less instead.
import { loadSoInvoicingState, orderTotalAfterReturns, overBilledValue, round2 } from "./invoicing"

type Db = any // supabase-js client (or a test double)

export const RETURN_CREDIT_TYPE = "sales_return"
export const RETURN_CREDIT_REFERENCE = "product_return"

const must = (result: any, what: string): any => {
  if (result.error) throw new Error(`${what}: ${result.error.message || result.error}`)
  return result.data
}

export async function creditInvoicedReturn(db: Db, ret: { return_id: number; so_id: number | null; so_number?: string | null }): Promise<{ amount: number } | null> {
  if (!ret.so_id) return null // historical returns carry no order link
  const state = await loadSoInvoicingState(db, ret.so_id)
  if (!state || state.invoices.length === 0) return null

  const all = state.returns || []
  const others = all.filter((r) => r.return_id !== ret.return_id)
  if (others.length === all.length) return null // this return no longer counts (rejected)
  const thisValue = orderTotalAfterReturns(state, others) - orderTotalAfterReturns(state, all)

  const orderReturnIds = [...new Set(all.map((r) => r.return_id))]
  const existing = must(
    await db.from("customer_credits").select("reference_id, amount").eq("credit_type", RETURN_CREDIT_TYPE).eq("reference_type", RETURN_CREDIT_REFERENCE).in("reference_id", orderReturnIds),
    "load return credits",
  ) as any[]
  if (existing.some((c) => Number(c.reference_id) === ret.return_id)) return null // credited already
  const alreadyCredited = existing.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  const overBilled = overBilledValue(state) - alreadyCredited
  const amount = round2(Math.min(thisValue, overBilled))
  if (!(amount > 0.005)) return null

  must(
    await db.from("customer_credits").insert({
      customer_id: state.so.customer_id,
      amount,
      credit_type: RETURN_CREDIT_TYPE,
      reference_type: RETURN_CREDIT_REFERENCE,
      reference_id: ret.return_id,
      description: `Return #${ret.return_id} on ${ret.so_number || state.so.so_number || `order ${ret.so_id}`}`,
      status: "active",
    }),
    "insert return credit",
  )
  return { amount }
}
