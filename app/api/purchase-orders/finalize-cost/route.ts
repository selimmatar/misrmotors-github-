import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { checkIdempotency, completeIdempotency } from "@/lib/idempotency"

export async function POST(request: Request) {
  try {
    console.log("[v0] PO Cost Finalization: Starting")
    const supabase = createAdminClient()
    const body = await request.json()

    const { poId, taxAmount, otherCosts, userId } = body

    if (!poId || taxAmount === undefined) {
      return NextResponse.json({ error: "Purchase Order ID and tax amount are required" }, { status: 400 })
    }

    const finalizeCostKey = `po_finalize_cost_${poId}_${Date.now()}`

    const idempotencyCheck = await checkIdempotency(
      "po_finalize_cost",
      finalizeCostKey,
      "purchase_orders",
      Number.parseInt(poId),
      userId,
    )

    if (!idempotencyCheck.success) {
      if (idempotencyCheck.isRetry) {
        console.log("[v0] PO Cost Finalization: Already finalized")
        return NextResponse.json({
          message: "Purchase order costs have already been finalized",
          isDuplicate: true,
        })
      }
      return NextResponse.json({ error: idempotencyCheck.error }, { status: 400 })
    }

    try {
      // Get the PO and its items
      const { data: po, error: poError } = await supabase
        .from("purchase_orders")
        .select("*, purchase_order_items(*)")
        .eq("po_id", poId)
        .single()

      if (poError || !po) {
        console.error("[v0] PO Cost Finalization: PO not found", poError)
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Purchase order not found")
        return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })
      }

      if (po.cost_finalized) {
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Already finalized")
        return NextResponse.json({ error: "Purchase order costs have already been finalized" }, { status: 400 })
      }

      if (po.status !== "approved" && po.status !== "received") {
        await completeIdempotency("po_finalize_cost", finalizeCostKey, false, "Invalid status")
        return NextResponse.json(
          { error: "Only approved or received purchase orders can have costs finalized" },
          { status: 400 },
        )
      }

      // ... existing cost calculation logic ...

      let itemUpdates: any[] = []

      if (body.isPerProduct && body.perProductTaxes) {
        itemUpdates = po.purchase_order_items.map((item: any) => {
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
        const totalOverhead = Number(taxAmount) + Number(otherCosts || 0)
        const poTotal = Number(po.total)

        itemUpdates = po.purchase_order_items.map((item: any) => {
          const itemTotal = Number(item.total)
          const proportion = itemTotal / poTotal

          const allocatedTax = Number((Number(taxAmount) * proportion).toFixed(2))
          const allocatedOverhead = Number((totalOverhead * proportion).toFixed(2))
          const landedCost = Number((itemTotal + allocatedOverhead).toFixed(2))

          return {
            po_item_id: item.po_item_id,
            allocated_tax: allocatedTax,
            allocated_overhead: allocatedOverhead,
            landed_cost: landedCost,
            product_id: item.product_id,
            quantity: item.quantity,
            tax_allocated_manually: false,
          }
        })
      }

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
          console.error("[v0] PO Cost Finalization: Error updating item", itemError)
          throw itemError
        }
      }

      // Update the PO
      const { data: updatedPO, error: updateError } = await supabase
        .from("purchase_orders")
        .update({
          tax_amount: taxAmount,
          other_costs: otherCosts || 0,
          cost_finalized: true,
          cost_finalized_at: new Date().toISOString(),
          cost_finalized_by_user_id: userId,
          cost_finalize_processing: false,
        })
        .eq("po_id", poId)
        .select()
        .single()

      if (updateError) {
        console.error("[v0] PO Cost Finalization: Error updating PO", updateError)
        throw updateError
      }

      await completeIdempotency("po_finalize_cost", finalizeCostKey, true)

      console.log("[v0] PO Cost Finalization: Success for PO", po.po_number)

      return NextResponse.json({
        success: true,
        po: updatedPO,
        items: itemUpdates,
      })
    } catch (error: any) {
      await completeIdempotency("po_finalize_cost", finalizeCostKey, false, error.message)
      throw error
    }
  } catch (error) {
    console.error("[v0] PO Cost Finalization: Error", error)
    return NextResponse.json({ error: "Failed to finalize purchase order costs" }, { status: 500 })
  }
}
