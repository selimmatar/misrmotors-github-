import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: Request) {
  try {
    const {
      inventoryId,
      quantity,
      unitCost,
      supplierName,
      supplierNameId,
      soNumber,
      productName,
    } = await request.json()

    const supabase = createAdminClient()

    // 1. Delete the returned item from inventory
    const { error: deleteError } = await supabase
      .from("inventory")
      .delete()
      .eq("inventory_id", inventoryId)

    if (deleteError) {
      console.error("[v0] Error deleting inventory:", deleteError)
      return NextResponse.json(
        { message: "Failed to remove item from inventory" },
        { status: 400 }
      )
    }

    // 2. Find the supplier_id via multiple strategies
    let supplierId: number | null = null

    // Strategy 1: use explicit supplier ID if passed
    if (supplierNameId) {
      supplierId = Number(supplierNameId)
    }

    // Strategy 2: look up by supplier name
    if (!supplierId && supplierName) {
      const { data: supplier } = await supabase
        .from("suppliers")
        .select("supplier_id")
        .ilike("supplier_name", `%${supplierName}%`)
        .limit(1)
        .single()
      if (supplier) supplierId = supplier.supplier_id
    }

    // Strategy 3: look up via SO number → purchase_orders → supplier_id
    if (!supplierId && soNumber) {
      const { data: poRows } = await supabase
        .from("purchase_orders")
        .select("supplier_id, purchase_order_items!inner(outsourced_name)")
        .eq("purchase_order_items.outsourced_name", productName || "")
        .limit(1)
      if (poRows && poRows.length > 0 && poRows[0].supplier_id) {
        supplierId = poRows[0].supplier_id
      }

      // Strategy 4: just get any PO supplier linked to the same SO items
      if (!supplierId) {
        const { data: poRows2 } = await supabase
          .from("purchase_order_items")
          .select("po_id, purchase_orders!inner(supplier_id)")
          .ilike("outsourced_name", `%${(productName || "").trim()}%`)
          .limit(1)
        if (poRows2 && poRows2.length > 0) {
          const po = poRows2[0].purchase_orders as any
          supplierId = po?.supplier_id || null
        }
      }
    }

    // 3. Create a supplier credit entry
    if (supplierId) {
      const creditAmount = (quantity || 0) * (unitCost || 0)

      const { error: creditError } = await supabase
        .from("supplier_credits")
        .insert({
          supplier_id: supplierId,
          amount: creditAmount,
          credit_type: "return",
          reference_type: "inventory",
          description: `Return of ${productName || "item"} (Qty: ${quantity})${soNumber ? ` from ${soNumber}` : ""}`,
          status: "active",
          created_at: new Date().toISOString(),
        })

      if (creditError) {
        console.error("Error creating supplier credit:", creditError)
        return NextResponse.json(
          { message: "Item removed but failed to create supplier credit" },
          { status: 400 }
        )
      }
    }

    return NextResponse.json(
      { message: "Returned item removed successfully", supplierId },
      { status: 200 }
    )
  } catch (error) {
    console.error("Error in remove-returned endpoint:", error)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}
