// Edit an OPEN purchase order (owner request, 2026-11-08; open POs 2026-11-11): supplier, order and delivery dates,
// the items (quantity, cost, lines added or removed) and the payment terms.
//  - Allowed in any status (even after goods were received) while the PO has no supplier bill. A closed PO is
//    reopened first (POST /api/purchase-orders/reopen).
//  - Lines are updated in place so receiving records stay linked; a line with goods received is kept at 0 when removed.
//  - Editing never moves stock. The receiving status follows the new quantities.
//  - The supplier cannot change while supplier credits / advances are reserved on the PO (they belong to the old one).
// Every step that writes is undone again if a later step fails.
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parsePositiveId } from "@/lib/parse-id"
import { checkPoOverOrder, linesWithIncreasedQuantity } from "@/lib/po-over-order"
import { computePoTotals, findExistingPoItem, mapPoItem, poPaymentColumns } from "@/lib/po-items"
import { editBlocker, syncPoStatus, writePoLines } from "@/lib/po-edit"
import { reservedCreditTotal } from "@/lib/supplier-credit-apply"

export const dynamic = "force-dynamic"

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status })

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
    const used = new Set<number>()
    const newRows = items.map((item: any) => {
      // A line that was already on the PO keeps its sales-order link and outsourced data when the form leaves them out.
      const before = findExistingPoItem(item, oldRows || [])
      const row = mapPoItem(item, poId, oldRows || [])
      if (before) {
        for (const key of ["source_so_id", "source_so_item_id", "outsourced_name", "outsourced_description", "outsourced_unit"] as const) {
          if (row[key] == null && before[key] != null) (row as any)[key] = before[key]
        }
      }
      // the same line keeps its id (receiving records point at it); a line is matched once
      const id = before && !used.has(before.po_item_id) ? before.po_item_id : undefined
      if (id) used.add(id)
      return { ...row, ...(id ? { po_item_id: id } : {}) }
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

    // 2. The lines, in place; then the receiving status follows the new quantities.
    await writePoLines(db, oldRows || [], newRows, undo)
    const status = await syncPoStatus(db, order, undo)

    return NextResponse.json({ ...order, status, id: String(order.po_id) })
  } catch (error) {
    console.error("Purchase order edit: failed", error)
    await rollBack()
    return refuse(500, "EDIT_FAILED", "The purchase order could not be saved. Nothing was changed; please try again.")
  }
}
