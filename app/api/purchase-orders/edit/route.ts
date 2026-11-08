// Edit a purchase order after it was made (owner request, 2026-11-08): supplier, order and delivery dates, the items
// (quantity, cost, lines added or removed) and the payment terms.
//  - Allowed while the PO is draft, pending or approved and nothing has been received on it yet.
//  - An approved PO stays approved; its supplier bill (accounts_payable) follows the new total, supplier and terms.
//  - Locked once a payment is recorded on that bill (supplier-credit offsets are not payments).
//  - The supplier cannot change while supplier credits are applied to the PO (they belong to the old supplier).
// Every step that writes is undone again if a later step fails, so the PO and its bill never disagree.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { checkPoOverOrder, linesWithIncreasedQuantity } from "@/lib/po-over-order"
import { computePoTotals, findExistingPoItem, mapPoItem, poPaymentColumns } from "@/lib/po-items"
import { editBlocker } from "@/lib/po-edit"
import { creditedInvoiceFields, reservedCreditTotal } from "@/lib/supplier-credit-apply"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status })

const today = () => new Date().toISOString().split("T")[0]
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)

export async function POST(request: Request) {
  const db = createAdminClient()
  const undo: (() => PromiseLike<unknown>)[] = []
  const rollBack = async () => {
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch (error) {
        console.error("Purchase order edit: could not undo a step", error)
      }
    }
  }
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") return refuse(400, "BAD_INPUT", "Invalid request")
    const poId = parsePositiveId(body.id)
    if (poId === null) return refuse(400, "BAD_INPUT", "A valid purchase order id is required")
    const items = Array.isArray(body.items) ? body.items : null
    if (!items || items.length === 0) return refuse(400, "BAD_INPUT", "A purchase order needs at least one item")
    for (const item of items) {
      if (!(Number(item.quantity) > 0)) return refuse(400, "BAD_INPUT", "Every item needs a quantity above 0")
      if (Number(item.unitPrice ?? item.unit_price ?? 0) < 0) return refuse(400, "BAD_INPUT", "A unit cost cannot be negative")
    }
    const supplierId = parsePositiveId(body.supplier_id ?? body.supplierId)
    if (supplierId === null) return refuse(400, "BAD_INPUT", "Choose a supplier")
    for (const key of ["order_date", "delivery_date"]) {
      if (body[key] != null && body[key] !== "" && !isDate(body[key])) return refuse(400, "BAD_INPUT", `Invalid ${key.replace("_", " ")}`)
    }

    const { data: current, error: currentError } = await db.from("purchase_orders").select("*").eq("po_id", poId).maybeSingle()
    if (currentError) throw currentError
    if (!current) return refuse(404, "NOT_FOUND", "Purchase order not found")

    const blocker = await editBlocker(db, current)
    if (blocker) return refuse(409, blocker.code, blocker.error)

    const { data: supplier, error: supplierError } = await db.from("suppliers").select("supplier_id").eq("supplier_id", supplierId).maybeSingle()
    if (supplierError) throw supplierError
    if (!supplier) return refuse(400, "BAD_INPUT", "Supplier not found")

    const reserved = await reservedCreditTotal(db, poId)
    if (reserved.error) throw new Error(reserved.error)
    const supplierChanged = Number(current.supplier_id) !== supplierId
    if (supplierChanged && reserved.total > 0) {
      return refuse(409, "PO_CREDIT_SUPPLIER", "Supplier credits of the current supplier are applied to this purchase order, so its supplier cannot be changed")
    }

    // Lines: the SO link and outsourced data of an existing line are kept (mapPoItem matches by id / SO line / name).
    const { data: oldRows, error: oldRowsError } = await db.from("purchase_order_items").select("*").eq("po_id", poId)
    if (oldRowsError) throw oldRowsError
    const newRows = items.map((item: any) => {
      // A line that was already on the PO keeps its sales-order link and outsourced data when the form leaves them out.
      const before = findExistingPoItem(item, oldRows || [])
      const row = mapPoItem(item, poId, oldRows || [])
      if (before) {
        for (const key of ["source_so_id", "source_so_item_id", "outsourced_name", "outsourced_description", "outsourced_unit"] as const) {
          if (row[key] == null && before[key] != null) (row as any)[key] = before[key]
        }
      }
      return row
    })
    const overOrder = await checkPoOverOrder(db, linesWithIncreasedQuantity(newRows, oldRows || []), poId)
    if (!overOrder.ok && !(body.allow_over_order === true && overOrder.code === "PO_OVER_ORDER")) {
      return NextResponse.json({ error: overOrder.error, code: overOrder.code, lines: overOrder.lines }, { status: overOrder.status })
    }
    const vatOn = body.vat === undefined ? Number(current.tax_amount) > 0 : body.vat === true
    const totals = computePoTotals(newRows, vatOn)
    if (reserved.total > totals.total + 0.005) {
      return refuse(409, "CREDIT_EXCEEDS_TOTAL", `The new total (${totals.total.toFixed(2)}) is less than the supplier credit applied to this order (${reserved.total.toFixed(2)})`, {
        applied: reserved.total,
        total: totals.total,
      })
    }

    // 1. The order itself, compare-and-swap on the status we checked.
    const changes: Record<string, any> = {
      ...poPaymentColumns(body),
      supplier_id: supplierId,
      order_date: body.order_date || current.order_date,
      delivery_date: body.delivery_date || null,
      total: totals.total,
      tax_amount: vatOn ? totals.tax : null,
    }
    const previous: Record<string, any> = {}
    for (const key of Object.keys(changes)) previous[key] = current[key] ?? null
    const { data: updated, error: updateError } = await db
      .from("purchase_orders")
      .update(changes)
      .eq("po_id", poId)
      .eq("status", current.status)
      .select()
    if (updateError) throw updateError
    const order = Array.isArray(updated) ? updated[0] : null
    if (!order) return refuse(409, "PO_STATUS_CONFLICT", "The purchase order was changed by someone else; reload and try again")
    undo.push(() => db.from("purchase_orders").update(previous).eq("po_id", poId))

    // 2. The lines: replaced; the old rows are put back if anything after this fails.
    const { error: deleteError } = await db.from("purchase_order_items").delete().eq("po_id", poId)
    if (deleteError) throw deleteError
    undo.push(async () => {
      await db.from("purchase_order_items").delete().eq("po_id", poId)
      if ((oldRows || []).length > 0) await db.from("purchase_order_items").insert(oldRows)
    })
    const { error: insertError } = await db.from("purchase_order_items").insert(newRows)
    if (insertError) throw insertError

    // 3. The supplier bill of an approved PO follows the order. Its unpaid payment schedule is made again from it.
    const { data: bills, error: billsError } = await db.from("accounts_payable").select("*").eq("po_id", poId)
    if (billsError) throw billsError
    const billUpdated = (bills || []).length > 0
    for (const bill of bills || []) {
      const credited = creditedInvoiceFields(totals.total, reserved.total)
      const paymentType = order.payment_type || order.payment_terms || "cash"
      const billChanges: Record<string, any> = {
        supplier_id: supplierId,
        amount: totals.total,
        paid_amount: credited.paid_amount,
        status: credited.status,
        due_date: order.down_payment_due_date || order.payment_start_date || bill.due_date || today(),
        payment_type: paymentType,
        payment_terms: paymentType,
        installment_months: order.installments || 1,
        down_payment_amount: order.down_payment_amount || null,
        down_payment_percent: order.down_payment_percent || null,
        down_payment_type: order.down_payment_type || null,
        down_payment_due_date: order.down_payment_due_date || null,
        remaining_amount: order.remaining_amount || null,
        remaining_installment_months: order.remaining_installment_months || null,
        monthly_amount: order.monthly_amount || null,
        payment_start_date: order.payment_start_date || null,
        schedule_entries: order.schedule_entries || null,
        schedule_mode: order.schedule_mode || "AUTO",
      }
      const billBefore: Record<string, any> = {}
      for (const key of Object.keys(billChanges)) billBefore[key] = bill[key] ?? null
      const { error: billError } = await db.from("accounts_payable").update(billChanges).eq("invoice_id", bill.invoice_id)
      if (billError) throw billError
      undo.push(() => db.from("accounts_payable").update(billBefore).eq("invoice_id", bill.invoice_id))

      const { data: schedules, error: schedulesError } = await db.from("payment_schedules").select("*").eq("invoice_id", bill.invoice_id)
      if (schedulesError) throw schedulesError
      if ((schedules || []).length > 0) {
        const { error: removeError } = await db.from("payment_schedules").delete().eq("invoice_id", bill.invoice_id)
        if (removeError) throw removeError
        undo.push(() => db.from("payment_schedules").insert(schedules))
      }
    }

    return NextResponse.json({ ...order, id: String(order.po_id), billUpdated })
  } catch (error) {
    console.error("Purchase order edit: failed", error)
    await rollBack()
    return refuse(500, "EDIT_FAILED", "The purchase order could not be saved. Nothing was changed; please try again.")
  }
}
