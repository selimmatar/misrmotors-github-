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

    // 2. Find the supplier by name to get supplier_id
    let supplierId: number | null = null

    if (supplierNameId) {
      supplierId = Number(supplierNameId)
    } else if (supplierName) {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .select("supplier_id")
        .ilike("supplier_name", supplierName)
        .single()

      if (!supplierError && supplier) {
        supplierId = supplier.supplier_id
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
        console.error("[v0] Error creating supplier credit:", creditError)
        return NextResponse.json(
          { message: "Item removed but failed to create supplier credit" },
          { status: 400 }
        )
      }

      console.log("[v0] Removed returned item and created supplier credit:", {
        inventoryId,
        supplierId,
        creditAmount,
        productName,
      })
    } else {
      console.warn("[v0] Could not find supplier for credit memo:", supplierName)
    }

    return NextResponse.json(
      { message: "Returned item removed successfully", supplierId },
      { status: 200 }
    )
  } catch (error) {
    console.error("[v0] Error in remove-returned endpoint:", error)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}
