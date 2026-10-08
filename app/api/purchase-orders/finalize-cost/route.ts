import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { checkIdempotency, completeIdempotency } from "@/lib/idempotency"

// Batch 4E: costs can only be finalized for a PO that has been received (at least partly), once.
const RECEIVED_STATUSES = ["received", "partially_received", "received_with_issues"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Split `amount` over the items in proportion to their pre-tax totals. Every share is rounded to 2 decimals and the
 * rounding remainder goes on the last item, so the shares always add up to `amount` exactly (to the cent).
 */
function allocateProportionally(amount: number, totals: number[]): number[] {
  const base = totals.reduce((s, t) => s + t, 0)
  const shares = totals.map((t) => money(amount * (t / base)))
  if (shares.length > 0) {
    const others = shares.slice(0, -1).reduce((s, v) => s + v, 0)
    shares[shares.length - 1] = money(amount - others)
  }
  return shares
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { poId: rawPoId, taxAmount, otherCosts, userId } = body

    if (!rawPoId || taxAmount === undefined) {
      return NextResponse.json({ error: "Purchase Order ID and tax amount are required" }, { status: 400 })
    }
    const poId = Number.parseInt(String(rawPoId), 10)
    if (!Number.isInteger(poId) || poId <= 0) {
      return NextResponse.json({ error: "Invalid purchase order ID" }, { status: 400 })
    }

    // Stable key: the same PO always maps to the same key, so a double submit is recognised.
    const finalizeCostKey = `po_finalize_cost_${poId}`

    const idempotencyCheck = await checkIdempotency("po_finalize_cost", finalizeCostKey, "purchase_orders", poId, userId)

    if (!idempotencyCheck.success) {
      if ("isRetry" in idempotencyCheck && idempotencyCheck.isRetry) {
        return NextResponse.json({
          message: "Purchase order costs have already been finalized",
          isDuplicate: true,
        })
      }
      const message = "error" in idempotencyCheck ? idempotencyCheck.error : "Operation failed"
      return NextResponse.json({ error: message }, { status: /already being processed/i.test(message) ? 409 : 400 })
    }

    let claimed = false
    let originalItems: any[] = []
    try {
      const { data: po, error: poError } = await supabase
        .from("purchase_orders")
        .select("*, purchase_order_items(*)")
        .eq("po_id", poId)
        .single()

      if (poError || !po) {
        console.error("PO Cost Finalization: PO not found", poError)
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Purchase order not found")
        return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
      }

      if (po.cost_finalized) {
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Already finalized")
        return NextResponse.json({ error: "Purchase order costs have already been finalized" }, { status: 409 })
      }

      if (!RECEIVED_STATUSES.includes(po.status)) {
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Not received")
        return NextResponse.json(
          { error: "Costs can only be finalized after goods have been received for this purchase order" },
          { status: 409 },
        )
      }

      const items: any[] = po.purchase_order_items || []
      originalItems = items.map((i) => ({
        po_item_id: i.po_item_id,
        allocated_tax: i.allocated_tax ?? null,
        allocated_overhead: i.allocated_overhead ?? null,
        landed_cost: i.landed_cost ?? null,
      }))

      let itemUpdates: any[] = []

      if (body.isPerProduct && body.perProductTaxes) {
        itemUpdates = items.map((item: any) => {
          const itemTotal = Number(item.total)
          const productTax = Number(body.perProductTaxes[item.po_item_id]?.tax) || 0
          const productOtherCosts = Number(body.perProductTaxes[item.po_item_id]?.otherCosts) || 0
          const allocatedOverhead = productTax + productOtherCosts
          const landedCost = Number((itemTotal + allocatedOverhead).toFixed(2))

          return {
            po_item_id: item.po_item_id,
            allocated_tax: Number(productTax.toFixed(2)),
            allocated_overhead: Number(allocatedOverhead.toFixed(2)),
            landed_cost: landedCost,
            product_id: item.product_id,
            quantity: item.quantity,
            tax_allocated_manually: true,
          }
        })
      } else {
        const tax = Number(taxAmount) || 0
        const totalOverhead = tax + Number(otherCosts || 0)
        // Allocation base = the items' own (pre-tax) totals. po.total already contains tax, so it must not be used.
        const totals = items.map((item: any) => Number(item.total) || 0)
        if (!(totals.reduce((s, t) => s + t, 0) > 0)) {
          await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "No item totals")
          return NextResponse.json({ error: "Purchase order has no item totals to allocate costs over" }, { status: 400 })
        }
        const taxShares = allocateProportionally(tax, totals)
        const overheadShares = allocateProportionally(totalOverhead, totals)

        itemUpdates = items.map((item: any, idx: number) => ({
          po_item_id: item.po_item_id,
          allocated_tax: taxShares[idx],
          allocated_overhead: overheadShares[idx],
          landed_cost: money(totals[idx] + overheadShares[idx]),
          product_id: item.product_id,
          quantity: item.quantity,
          tax_allocated_manually: false,
        }))
      }

      // Claim first: only one request can flip cost_finalized from false/null to true (single guarded statement).
      const claim = await supabase
        .from("purchase_orders")
        .update({
          cost_finalized: true,
          cost_finalized_at: new Date().toISOString(),
          ...(typeof userId === "string" && UUID.test(userId) ? { cost_finalized_by_user_id: userId } : {}),
        })
        .eq("po_id", poId)
        .in("status", RECEIVED_STATUSES)
        .or("cost_finalized.is.null,cost_finalized.eq.false")
        .select("po_id")
      if (claim.error) throw new Error(`claim: ${claim.error.message}`)
      if (!claim.data || claim.data.length !== 1) {
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Lost the claim")
        return NextResponse.json(
          { error: "Purchase order costs have already been finalized or are being finalized by another request" },
          { status: 409 },
        )
      }
      claimed = true

      // Update all items
      for (const update of itemUpdates) {
        const { error: itemError } = await supabase
          .from("purchase_order_items")
          .update({
            allocated_tax: update.allocated_tax,
            allocated_overhead: update.allocated_overhead,
            landed_cost: update.landed_cost,
          })
          .eq("po_item_id", update.po_item_id)

        if (itemError) {
          console.error("PO Cost Finalization: Error updating item", itemError)
          throw new Error(`item ${update.po_item_id}: ${itemError.message}`)
        }
      }

      // Header figures
      const { data: updatedPO, error: updateError } = await supabase
        .from("purchase_orders")
        .update({
          tax_amount: taxAmount,
          other_costs: otherCosts || 0,
          cost_finalize_processing: false,
        })
        .eq("po_id", poId)
        .select()
        .single()

      if (updateError) {
        console.error("PO Cost Finalization: Error updating PO", updateError)
        throw new Error(`purchase order: ${updateError.message}`)
      }

      await completeIdempotency("po_finalize_cost", finalizeCostKey, true)

      return NextResponse.json({
        success: true,
        po: updatedPO,
        items: itemUpdates,
      })
    } catch (error: any) {
      // Release the claim we took (guarded: only while still finalized) and put the item figures back, best effort.
      let released = !claimed
      if (claimed) {
        for (const o of originalItems) {
          const { error: restoreError } = await supabase
            .from("purchase_order_items")
            .update({ allocated_tax: o.allocated_tax, allocated_overhead: o.allocated_overhead, landed_cost: o.landed_cost })
            .eq("po_item_id", o.po_item_id)
          if (restoreError) console.error("PO Cost Finalization: could not restore item", o.po_item_id, restoreError.message)
        }
        const { error: releaseError } = await supabase
          .from("purchase_orders")
          .update({ cost_finalized: false, cost_finalized_at: null })
          .eq("po_id", poId)
          .eq("cost_finalized", true)
        if (releaseError) console.error("PO Cost Finalization: could not release the claim", releaseError.message)
        else released = true
      }
      await completeIdempotency("po_finalize_cost", finalizeCostKey, false, error.message)
      console.error("PO Cost Finalization: Error", error)
      return NextResponse.json(
        {
          error: `Failed to finalize purchase order costs (${error.message}). ${
            released ? "Nothing was finalized; you can try again." : "The purchase order may be left marked as finalized; please check it."
          }`,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("PO Cost Finalization: Error", error)
    return NextResponse.json({ error: "Failed to finalize purchase order costs" }, { status: 500 })
  }
}
