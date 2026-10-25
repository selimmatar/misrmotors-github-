import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { takeFromRow, undoMoves, type StockMove } from "@/lib/dp-stock"

export async function POST(request: Request) {
  try {
    const adminClient = createAdminClient()
    const body = await request.json()
    
    const { report_id, work_order_id, approved, rejection_reason } = body
    

    if (approved) {
      // Claim the approval first (only one request can set approved_at), so a double click or a retry never takes
      // the parts twice. Every exit below that does not finish the approval gives the claim back.
      const approvedAt = new Date().toISOString()
      const { data: claimed, error: claimError } = await adminClient
        .from("maintenance_reports")
        .update({ approved_by: "sales", approved_at: approvedAt })
        .eq("report_id", report_id)
        .is("approved_at", null)
        .select("*")
      if (claimError) {
        console.error("Could not approve report:", claimError)
        return NextResponse.json({ error: "Could not approve the report. Nothing was changed." }, { status: 500 })
      }
      const report = claimed?.[0]
      if (!report) {
        const { data: existing } = await adminClient.from("maintenance_reports").select("report_id").eq("report_id", report_id).maybeSingle()
        return existing
          ? NextResponse.json({ error: "This report is already approved. The parts were taken from stock the first time." }, { status: 409 })
          : NextResponse.json({ error: "Report not found" }, { status: 404 })
      }
      const unclaim = () =>
        adminClient.from("maintenance_reports").update({ approved_by: null, approved_at: null }).eq("report_id", report_id).eq("approved_at", approvedAt)

      // Parts from stock, summed per product
      const needByProduct = new Map<number, { need: number; name: string }>()
      for (const m of (report.parts_used || []) as any[]) {
        if (m?.type !== "inventory" || !m.productId || !(Number(m.quantity) > 0)) continue
        const id = Number(m.productId)
        const entry = needByProduct.get(id) || { need: 0, name: m.productName || `product ${id}` }
        entry.need += Number(m.quantity)
        needByProduct.set(id, entry)
      }

      // The parts are not tied to a warehouse, so each product is taken from ONE sellable (not returned) row that holds
      // enough: the one with the most stock. Every product is checked before anything moves; nothing is clamped to 0.
      const plan: { row: any; need: number; name: string }[] = []
      const short: string[] = []
      if (needByProduct.size > 0) {
        const { data: rows, error: invError } = await adminClient
          .from("inventory")
          .select("inventory_id, product_id, warehouse_id, quantity")
          .in("product_id", [...needByProduct.keys()])
          .eq("is_returned", false)
        if (invError) {
          await unclaim()
          return NextResponse.json({ error: "Could not read the stock. Nothing was changed." }, { status: 500 })
        }
        for (const [productId, { need, name }] of needByProduct) {
          const best = ((rows || []) as any[])
            .filter((r) => Number(r.product_id) === productId)
            .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0]
          if (!best || Number(best.quantity) < need) short.push(`${name}: needed ${need}, in stock ${Number(best?.quantity) || 0}`)
          else plan.push({ row: best, need, name })
        }
      }
      if (short.length > 0) {
        await unclaim()
        return NextResponse.json(
          { error: `Cannot approve: ${short.join("; ")}. Nothing was taken from stock.`, code: "INSUFFICIENT_STOCK" },
          { status: 409 },
        )
      }

      const moves: StockMove[] = []
      for (const { row, need, name } of plan) {
        const taken = await takeFromRow(adminClient, row.inventory_id, need)
        if (!taken.ok) {
          await undoMoves(adminClient, moves)
          await unclaim()
          return NextResponse.json(
            { error: `Cannot approve: ${name}: needed ${need}, in stock ${taken.available}. Nothing was taken from stock.`, code: "INSUFFICIENT_STOCK" },
            { status: 409 },
          )
        }
        moves.push({ inventoryId: row.inventory_id, productId: Number(row.product_id), warehouseId: row.warehouse_id ?? null, quantity: need, before: taken.before, after: taken.after, productName: name })
      }

      // Update work order status to completed (approved)
      const { error: woError } = await adminClient
        .from("maintenance_work_orders")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("work_order_id", work_order_id)

      if (woError) {
        console.error("Error updating work order:", woError)
        const notRestored = await undoMoves(adminClient, moves)
        await unclaim()
        const error = notRestored.length
          ? "Failed to update work order, and some parts could not be put back in stock. Ask an administrator to check the stock."
          : "Failed to update work order. The parts were put back in stock; try again."
        return NextResponse.json({ error }, { status: 500 })
      }

      if (moves.length > 0) {
        // 'adjustment' is one of the four types the database accepts (purchase, sale, adjustment, return)
        const { error: txError } = await adminClient.from("inventory_transactions").insert(
          moves.map((m) => ({
            product_id: m.productId,
            transaction_type: "adjustment",
            quantity_change: -m.quantity,
            quantity_before: m.before,
            quantity_after: m.after,
            reference_type: "MAINTENANCE",
            reference_id: work_order_id,
            reference_number: `WO-${work_order_id}`,
            notes: `Maintenance parts - Report #${report_id} - ${m.productName}${m.warehouseId ? ` - warehouse ${m.warehouseId}` : ""}`,
          })),
        )
        if (txError) console.error("Maintenance stock record failed (stock stays deducted):", txError.message)
      }

      return NextResponse.json({ 
        success: true, 
        message: "Report approved and inventory updated",
        workflow_stage: "approved",
        items_deducted: moves.length
      })
    } else {
      // Reject: change work order back to in_progress
      const { error: woError } = await adminClient
        .from("maintenance_work_orders")
        .update({
          status: "in_progress",
          notes: rejection_reason ? `REJECTED: ${rejection_reason}` : "Report rejected by sales",
          updated_at: new Date().toISOString(),
        })
        .eq("work_order_id", work_order_id)

      if (woError) {
        console.error("Error updating work order:", woError)
        return NextResponse.json({ error: "Failed to update work order" }, { status: 500 })
      }

      
      return NextResponse.json({ 
        success: true, 
        message: "Report rejected and sent back to shipping",
        workflow_stage: "assigned"
      })
    }
  } catch (error) {
    console.error("Error in approval process:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
