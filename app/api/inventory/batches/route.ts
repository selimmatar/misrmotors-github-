import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get("productId")

    let query = supabase
      .from("inventory_batches")
      .select(`
        *,
        products:product_id (product_name, sku)
      `)
      .order("received_date", { ascending: true })

    if (productId) {
      query = query.eq("product_id", Number.parseInt(productId))
    }

    // Only show batches with available quantity
    query = query.gt("quantity_available", 0)

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Error fetching inventory batches:", error)
    return NextResponse.json({ error: "Failed to fetch inventory batches" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const { productId, poId, poNumber, quantity, unitCost, landedCostPerUnit, receivedDate } = body

    if (!productId || !quantity || !unitCost) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Get the next batch sequence for this product
    const { data: lastBatch } = await supabase
      .from("inventory_batches")
      .select("batch_sequence")
      .eq("product_id", productId)
      .order("batch_sequence", { ascending: false })
      .limit(1)
      .single()

    const nextSequence = (lastBatch?.batch_sequence || 0) + 1

    const { data, error } = await supabase
      .from("inventory_batches")
      .insert({
        product_id: productId,
        po_id: poId,
        po_number: poNumber,
        quantity_received: quantity,
        quantity_available: quantity,
        unit_cost: unitCost,
        landed_cost_per_unit: landedCostPerUnit || unitCost,
        received_date: receivedDate || new Date().toISOString().split("T")[0],
        batch_sequence: nextSequence,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[v0] Error creating inventory batch:", error)
    return NextResponse.json({ error: error.message || "Failed to create inventory batch" }, { status: 500 })
  }
}
