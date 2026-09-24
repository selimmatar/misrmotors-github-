import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Moves a returned-holding inventory row's quantity back into the warehouse's
// regular sellable stock, then removes the returned row. This is the
// counterpart to /api/inventory/remove-returned (write-off + supplier credit).
export async function POST(request: Request) {
  try {
    const { inventoryId } = await request.json()

    if (!inventoryId) {
      return NextResponse.json({ message: "inventoryId is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: returnedRow, error: fetchError } = await supabase
      .from("inventory")
      .select("*")
      .eq("inventory_id", inventoryId)
      .maybeSingle()

    if (fetchError) {
      console.error("Error fetching returned inventory row:", fetchError)
      return NextResponse.json({ message: "Failed to load returned item" }, { status: 400 })
    }

    if (!returnedRow) {
      return NextResponse.json({ message: "Returned item not found" }, { status: 404 })
    }

    if (!returnedRow.is_returned) {
      return NextResponse.json({ message: "This item is not a pending return" }, { status: 400 })
    }

    // Outsourced returns have no product_id and no ongoing "main stock" row to
    // merge into — restocking them just means clearing the returned flag so
    // they show up as regular on-hand outsourced stock.
    if (!returnedRow.product_id) {
      const { error: updateError } = await supabase
        .from("inventory")
        .update({ is_returned: false, last_updated: new Date().toISOString() })
        .eq("inventory_id", inventoryId)

      if (updateError) {
        console.error("Error restocking outsourced return:", updateError)
        return NextResponse.json({ message: "Failed to restock item" }, { status: 400 })
      }

      return NextResponse.json({ message: "Item restocked to warehouse" }, { status: 200 })
    }

    // Regular product — find the main (non-returned) on-hand row for the same
    // product + warehouse and add the returned quantity into it.
    const { data: mainRow, error: mainFetchError } = await supabase
      .from("inventory")
      .select("*")
      .eq("product_id", returnedRow.product_id)
      .eq("warehouse_id", returnedRow.warehouse_id)
      .eq("is_returned", false)
      .maybeSingle()

    if (mainFetchError) {
      console.error("Error fetching main inventory row:", mainFetchError)
      return NextResponse.json({ message: "Failed to load warehouse stock" }, { status: 400 })
    }

    if (mainRow) {
      const { error: updateError } = await supabase
        .from("inventory")
        .update({
          quantity: (mainRow.quantity || 0) + (returnedRow.quantity || 0),
          last_updated: new Date().toISOString(),
        })
        .eq("inventory_id", mainRow.inventory_id)

      if (updateError) {
        console.error("Error updating main inventory row:", updateError)
        return NextResponse.json({ message: "Failed to restock item" }, { status: 400 })
      }
    } else {
      const { error: insertError } = await supabase.from("inventory").insert({
        product_id: returnedRow.product_id,
        warehouse_id: returnedRow.warehouse_id,
        quantity: returnedRow.quantity || 0,
        unit_cost: returnedRow.unit_cost || 0,
        reorder_point: 10,
        is_outsourced: false,
        location: returnedRow.location || null,
        last_updated: new Date().toISOString(),
      })

      if (insertError) {
        console.error("Error creating main inventory row:", insertError)
        return NextResponse.json({ message: "Failed to restock item" }, { status: 400 })
      }
    }

    // The returned quantity has now been absorbed into the main stock row, so
    // the holding row is removed.
    const { error: deleteError } = await supabase.from("inventory").delete().eq("inventory_id", inventoryId)

    if (deleteError) {
      console.error("Error deleting returned inventory row:", deleteError)
      return NextResponse.json(
        { message: "Item was restocked but the returns record could not be cleared" },
        { status: 400 },
      )
    }

    return NextResponse.json({ message: "Item restocked to warehouse" }, { status: 200 })
  } catch (error) {
    console.error("Error in restock-returned endpoint:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
