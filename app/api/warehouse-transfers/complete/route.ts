import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

// Batch 4E: completing a transfer is claim-first and every stock change is a guarded compare-and-swap
// (there are no database transactions). A failure part-way puts back what was already moved (best effort).
const MAX_CAS_ATTEMPTS = 8
const SELECT_COLS = "inventory_id, quantity, unit_cost, reorder_point, is_outsourced, outsourced_name, outsourced_description, supplier_name"

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const whereQuantity = (query: any, old: unknown) => (old === null || old === undefined ? query.is("quantity", null) : query.eq("quantity", old))

/** Weighted-average unit cost (2 decimals); no stock on hand (or unknown cost) means the incoming cost. */
function averageCost(oldQty: unknown, oldCost: unknown, addQty: number, addCost: number) {
  const q = Number(oldQty)
  const c = oldCost === null || oldCost === undefined ? NaN : Number(oldCost)
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || addQty <= 0) return money(addCost)
  return money((q * c + addQty * addCost) / (q + addQty))
}

type Undo = { what: string; run: () => Promise<void> }

async function readInventory(supabase: any, build: (q: any) => any) {
  const { data, error } = await build(supabase.from("inventory").select(SELECT_COLS)).limit(1)
  if (error) throw new HttpError(500, `Failed to read inventory: ${error.message}`)
  return (data && data[0]) || null
}

/** Source row of a transfer item: source_inventory_id first, else product + source warehouse (sellable stock only). */
async function findSource(supabase: any, transfer: any, item: any) {
  let row: any = null
  if (item.source_inventory_id) row = await readInventory(supabase, (q) => q.eq("inventory_id", item.source_inventory_id))
  if (!row && item.product_id) {
    // never move the returned-holding row (is_returned = true)
    row = await readInventory(supabase, (q) => q.eq("product_id", item.product_id).eq("warehouse_id", transfer.source_warehouse_id).eq("is_returned", false))
  }
  return row
}

/** Take `qty` out of one source row: compare-and-swap on the quantity read, never below zero. */
async function deductSource(supabase: any, inventoryId: number, qty: number, label: string, undo: Undo[]) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = await readInventory(supabase, (q) => q.eq("inventory_id", inventoryId))
    if (!row) throw new HttpError(404, `Cannot find source inventory for ${label}`)
    const have = Number(row.quantity) || 0
    if (have < qty) throw new HttpError(409, `Insufficient stock for ${label}: ${have} available, ${qty} needed`)
    const { data, error } = await whereQuantity(supabase.from("inventory").update({ quantity: have - qty }).eq("inventory_id", inventoryId), row.quantity).select("inventory_id")
    if (error) throw new HttpError(500, `Failed to deduct from source: ${error.message}`)
    if (data && data.length === 1) {
      undo.push({ what: `source ${inventoryId} -${qty}`, run: () => adjustQuantity(supabase, inventoryId, qty) })
      return row
    }
    // lost a race on the same row: re-read and re-check
  }
  throw new HttpError(409, `Inventory for ${label} is being changed by other requests; try again`)
}

/** Add (or, with a negative delta, take) a quantity on a row with compare-and-swap; optionally restore a cost. Used by undo and destination. */
async function adjustQuantity(supabase: any, inventoryId: number, delta: number, cost?: { from: number; to: unknown }) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = await readInventory(supabase, (q) => q.eq("inventory_id", inventoryId))
    if (!row) return
    const patch: Record<string, unknown> = { quantity: Math.max(0, (Number(row.quantity) || 0) + delta) }
    if (cost && Number(row.unit_cost) === cost.from && cost.to !== undefined) patch.unit_cost = cost.to
    const { data, error } = await whereQuantity(supabase.from("inventory").update(patch).eq("inventory_id", inventoryId), row.quantity).select("inventory_id")
    if (error) throw new Error(error.message)
    if (data && data.length === 1) return
  }
  throw new Error(`could not adjust inventory ${inventoryId}`)
}

async function removeCreated(supabase: any, inventoryId: number, qty: number) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = await readInventory(supabase, (q) => q.eq("inventory_id", inventoryId))
    if (!row) return
    const left = (Number(row.quantity) || 0) - qty
    if (left <= 0) {
      const { data, error } = await whereQuantity(supabase.from("inventory").delete().eq("inventory_id", inventoryId), row.quantity).select("inventory_id")
      if (error) throw new Error(error.message)
      if (data && data.length === 1) return
    } else {
      return adjustQuantity(supabase, inventoryId, -qty)
    }
  }
  throw new Error(`could not remove inventory ${inventoryId}`)
}

/** Add to the destination: update the existing row with compare-and-swap (weighted-average cost) or create it. */
async function addDestination(supabase: any, transfer: any, item: any, source: any, qty: number, isOutsourced: boolean, undo: Undo[]) {
  const outsourcedName = source.outsourced_name || item.outsourced_name || item.product_name || "Outsourced Item"
  const incomingCost = Number(source.unit_cost) || 0
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const dest = await readInventory(supabase, (q) =>
      isOutsourced
        ? q.eq("warehouse_id", transfer.destination_warehouse_id).eq("is_outsourced", true).eq("outsourced_name", outsourcedName)
        : q.eq("product_id", item.product_id).eq("warehouse_id", transfer.destination_warehouse_id).eq("is_returned", false),
    )
    if (dest) {
      const newCost = averageCost(dest.quantity, dest.unit_cost, qty, incomingCost)
      const { data, error } = await whereQuantity(
        supabase.from("inventory").update({ quantity: (Number(dest.quantity) || 0) + qty, unit_cost: newCost }).eq("inventory_id", dest.inventory_id),
        dest.quantity,
      ).select("inventory_id")
      if (error) throw new HttpError(500, `Failed to add to destination: ${error.message}`)
      if (data && data.length === 1) {
        undo.push({ what: `destination ${dest.inventory_id} +${qty}`, run: () => adjustQuantity(supabase, dest.inventory_id, -qty, { from: newCost, to: dest.unit_cost }) })
        return
      }
      continue // lost a race on the same row: re-read and try again
    }
    const insertPayload: any = {
      warehouse_id: transfer.destination_warehouse_id,
      quantity: qty,
      reorder_point: source.reorder_point ?? (isOutsourced ? 0 : 10),
      unit_cost: source.unit_cost || 0,
      location: "Transfer",
      is_outsourced: isOutsourced,
      is_returned: false,
      supplier_name: source.supplier_name || null,
    }
    if (isOutsourced) {
      insertPayload.product_id = null
      insertPayload.outsourced_name = outsourcedName
      insertPayload.outsourced_description = source.outsourced_description || "Transferred outsourced item"
    } else {
      insertPayload.product_id = item.product_id
    }
    const inserted = await supabase.from("inventory").insert(insertPayload).select("inventory_id").single()
    if (!inserted.error && inserted.data) {
      const id = inserted.data.inventory_id
      undo.push({ what: `destination ${id} created`, run: () => removeCreated(supabase, id, qty) })
      return
    }
    if (inserted.error && inserted.error.code !== "23505") throw new HttpError(500, `Failed to create destination inventory: ${inserted.error.message}`)
    // somebody created the row at the same moment: loop and update it instead
  }
  throw new HttpError(409, "Destination inventory is being changed by other requests; try again")
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient() as any
    const body = await request.json()

    const { transferId } = body

    if (!transferId) {
      return NextResponse.json({ error: "Transfer ID is required" }, { status: 400 })
    }

    // Fetch transfer with items
    const { data: transfer, error: transferError } = await supabase
      .from("warehouse_transfers")
      .select(`
        *,
        warehouse_transfer_items(*)
      `)
      .eq("transfer_id", transferId)
      .single()

    if (transferError || !transfer) {
      console.error("Transfer not found:", transferError)
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 })
    }

    if (transfer.status !== "pending" && transfer.status !== "in_transit") {
      return NextResponse.json({ error: `Cannot complete transfer with status: ${transfer.status}` }, { status: 409 })
    }

    const items: any[] = (transfer.warehouse_transfer_items || []).map((item: any) => ({
      ...item,
      qty: Number(item.quantity_sent || item.quantity_requested || 0),
      isOutsourced: Boolean(item.is_outsourced || !item.product_id),
    }))

    // 1) Check that every item can be moved BEFORE anything is touched (items that share a source row are summed)
    const needed = new Map<number, { have: number; need: number; label: string }>()
    for (const item of items) {
      if (item.qty <= 0) continue
      const label = item.product_name || "item"
      const source = await findSource(supabase, transfer, item)
      if (!source) return NextResponse.json({ error: `Cannot find source inventory for ${label}` }, { status: 404 })
      item.sourceId = source.inventory_id
      const entry = needed.get(source.inventory_id) || { have: Number(source.quantity) || 0, need: 0, label }
      entry.need += item.qty
      needed.set(source.inventory_id, entry)
    }
    for (const { have, need, label } of needed.values()) {
      if (have < need) {
        return NextResponse.json({ error: `Insufficient stock for ${label}: ${have} available, ${need} needed. Nothing was moved.` }, { status: 409 })
      }
    }

    // 2) Claim the transfer: one guarded statement; the request that loses gets 409 and moves nothing
    const claim = await supabase
      .from("warehouse_transfers")
      .update({ status: "completed", completion_date: new Date().toISOString().split("T")[0] })
      .eq("transfer_id", transferId)
      .in("status", ["pending", "in_transit"])
      .select("transfer_id")
    if (claim.error) {
      console.error("Error claiming transfer:", claim.error)
      return NextResponse.json({ error: "Failed to complete transfer" }, { status: 500 })
    }
    if (!claim.data || claim.data.length !== 1) {
      return NextResponse.json({ error: "Transfer was already completed or is being completed by another request" }, { status: 409 })
    }

    // 3) Move the stock
    const undo: Undo[] = []
    try {
      for (const item of items) {
        if (item.qty <= 0) continue
        const source = await deductSource(supabase, item.sourceId, item.qty, item.product_name || "item", undo)
        await addDestination(supabase, transfer, item, source, item.qty, item.isOutsourced, undo)
      }
    } catch (error: any) {
      // put back what was moved, newest first, then re-open the transfer
      const failed: string[] = []
      for (const step of undo.reverse()) {
        try {
          await step.run()
        } catch (undoError: any) {
          failed.push(`${step.what} (${undoError?.message})`)
        }
      }
      const { error: revertError } = await supabase
        .from("warehouse_transfers")
        .update({ status: transfer.status, completion_date: transfer.completion_date ?? null })
        .eq("transfer_id", transferId)
        .eq("status", "completed")
      if (revertError) failed.push(`transfer status (${revertError.message})`)
      console.error("Error moving transfer stock:", error)
      const status = error instanceof HttpError ? error.status : 500
      const suffix = failed.length ? ` WARNING: could not fully undo: ${failed.join("; ")}. Please check the inventory and the transfer.` : " Nothing was moved."
      return NextResponse.json({ error: `${error?.message || "Failed to complete transfer"}.${suffix}` }, { status })
    }

    // 4) Audit log. A failure here is logged but never undoes a completed transfer.
    // inventory_transactions only allows purchase/sale/adjustment/return, so a transfer is two 'adjustment' rows.
    for (const item of items) {
      if (item.qty <= 0 || !item.product_id) continue // outsourced items have no product_id
      const { error: auditError } = await supabase.from("inventory_transactions").insert([
        {
          product_id: item.product_id,
          transaction_type: "adjustment",
          quantity_change: -item.qty,
          reference_type: "WAREHOUSE_TRANSFER",
          reference_number: transfer.transfer_number,
          reference_id: transfer.transfer_id,
          notes: `Transfer out to warehouse ${transfer.destination_warehouse_id}`,
        },
        {
          product_id: item.product_id,
          transaction_type: "adjustment",
          quantity_change: item.qty,
          reference_type: "WAREHOUSE_TRANSFER",
          reference_number: transfer.transfer_number,
          reference_id: transfer.transfer_id,
          notes: `Transfer in from warehouse ${transfer.source_warehouse_id}`,
        },
      ])
      if (auditError) console.error(`Transfer ${transfer.transfer_number}: audit log insert failed for product ${item.product_id}:`, auditError.message)
    }

    return NextResponse.json({
      success: true,
      message: "Transfer completed successfully",
    })
  } catch (error) {
    console.error("Error completing transfer:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
