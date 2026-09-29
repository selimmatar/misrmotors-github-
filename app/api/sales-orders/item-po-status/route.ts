import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Tells the "Edit Order" dialog which line items already have a purchase order sourced
// from them, so the sales rep gets a warning before removing or shrinking an item that
// procurement is already acting on.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const soId = searchParams.get("soId")

    if (!soId) {
      return NextResponse.json({ error: "soId is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("purchase_order_items")
      .select(`
        source_so_item_id,
        purchase_orders:po_id (po_number, status)
      `)
      .eq("source_so_id", Number.parseInt(soId))
      .not("source_so_item_id", "is", null)

    if (error) {
      throw error
    }

    const itemPoStatus: Record<string, { poNumber: string; status: string }> = {}
    for (const row of data || []) {
      const po = row.purchase_orders as any
      if (row.source_so_item_id && po) {
        itemPoStatus[String(row.source_so_item_id)] = {
          poNumber: po.po_number,
          status: po.status,
        }
      }
    }

    return NextResponse.json({ itemPoStatus })
  } catch (error) {
    console.error("Sales Order item-po-status GET: Failed", error)
    return NextResponse.json({ error: "Failed to fetch item purchase order status" }, { status: 500 })
  }
}
